import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadDefaultRules } from "./rules/loader";
import { createRuleEngine, type ResolvedAction } from "./rules/engine";
import { createLimiter } from "./actions/limiter";
import { createExecutor } from "./actions/executor";
import { emit, formatNotification } from "./notify/terminal";
import { watchDeadDir, watchInboxDir, watchLogDir } from "./paths";
import type { ActionResult, RepoState, Signal } from "./types";

export interface DrainConfig {
  inboxDir?: string;
  deadDir?: string;
  logDir?: string;
  maxConcurrent?: number;
  maxActionsPerHour?: number;
  /** Test seam: bypass real Claude subprocess. */
  executorOverride?: (action: ResolvedAction, repo: string) => Promise<ActionResult>;
}

export interface DrainSummary {
  scanned: number;    // inbox files considered
  processed: number;  // processed successfully and deleted
  deferred: number;   // left in inbox (action failed or limiter deferred) — retried next pass
  poisoned: number;   // unparseable, moved to dead/
}

/** Parse one inbox file's contents into a Signal. Throws on anything malformed. */
export function parseInboxSignal(raw: string): Signal {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("signal must be a JSON object");
  if (typeof parsed.source !== "string" || typeof parsed.type !== "string") {
    throw new Error("signal missing source/type");
  }
  if (typeof parsed.repo !== "string" || parsed.repo.length === 0) {
    throw new Error("signal missing repo");
  }
  const metadata: Record<string, unknown> = { ...(parsed.metadata ?? {}) };
  // The hook script emits files as a comma-joined string; predicates expect string[].
  if (typeof metadata.files === "string") {
    metadata.files = (metadata.files as string).split(",").filter(f => f.length > 0);
  }
  return {
    id: typeof parsed.id === "string" ? parsed.id : `sig_${randomUUID()}`,
    source: parsed.source,
    type: parsed.type,
    repo: parsed.repo,
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    metadata,
  };
}

// Same Phase-1 minimal repo state the daemon used: safe defaults until a
// proper git inspection helper lands.
function getRepoState(_repo: string): RepoState {
  return {
    branch: "unknown", branchAgeHours: 0, hasDiff: false,
    isDefaultBranch: false, recentActions: [],
  };
}

function listInboxFiles(inboxDir: string): string[] {
  if (!existsSync(inboxDir)) return [];
  const names = readdirSync(inboxDir).filter(n => n.endsWith(".json") && !n.startsWith("."));
  // Oldest first. Filenames are <timestamp>-<pid>.json so name order is a good
  // tiebreak; mtime is the primary key so foreign filenames still sort sanely.
  return names
    .map(n => {
      let mtime = 0;
      try { mtime = statSync(join(inboxDir, n)).mtimeMs; } catch {}
      return { n, mtime };
    })
    .sort((a, b) => a.mtime - b.mtime || (a.n < b.n ? -1 : 1))
    .map(e => e.n);
}

function moveToDead(inboxDir: string, deadDir: string, name: string): void {
  mkdirSync(deadDir, { recursive: true });
  let dest = join(deadDir, name);
  if (existsSync(dest)) dest = join(deadDir, `${Date.now()}-${name}`);
  renameSync(join(inboxDir, name), dest);
}

/**
 * One drain pass: read every event file in the inbox (oldest first), run each
 * through the rules engine, execute resolved actions through limiter+executor,
 * delete the file once fully processed. No daemon, no loop.
 *
 * Failure semantics per file:
 * - unparseable  -> moved to dead/ (poison files can't wedge the drain)
 * - action error -> file stays in the inbox, retried on the next pass
 * - limiter full -> file stays in the inbox, retried on the next pass
 */
export async function drainInbox(cfg: DrainConfig = {}): Promise<DrainSummary> {
  const inboxDir = cfg.inboxDir ?? watchInboxDir();
  const deadDir = cfg.deadDir ?? watchDeadDir();
  const logDir = cfg.logDir ?? watchLogDir();

  const rules = await loadDefaultRules();
  const engine = createRuleEngine(rules);
  const limiter = createLimiter({
    maxConcurrent: cfg.maxConcurrent ?? 3,
    maxActionsPerHour: cfg.maxActionsPerHour ?? 30,
  });
  const executor = createExecutor({ logDir });

  const summary: DrainSummary = { scanned: 0, processed: 0, deferred: 0, poisoned: 0 };

  for (const name of listInboxFiles(inboxDir)) {
    summary.scanned++;
    const filePath = join(inboxDir, name);

    let signal: Signal;
    try {
      signal = parseInboxSignal(readFileSync(filePath, "utf8"));
    } catch (err) {
      emit(`[gstack-watch] poison inbox file ${name}: ${(err as Error).message} — moved to dead/`);
      try {
        moveToDead(inboxDir, deadDir, name);
        summary.poisoned++;
      } catch (moveErr) {
        emit(`[gstack-watch] could not quarantine ${name}: ${(moveErr as Error).message}`);
        summary.deferred++;
      }
      continue;
    }

    let fileOk = true;
    const actions = engine.evaluate(signal, getRepoState(signal.repo));
    for (const action of actions) {
      const isRunnable = action.action.type === "auto-run" || action.action.type === "suggest";
      const skill = isRunnable ? action.action.skill : "(unknown)";

      if (action.action.type !== "auto-run") {
        if (action.action.type === "suggest") {
          emit(formatNotification({
            kind: "suggestion", rule_id: action.rule_id, skill,
            reason: `signal ${signal.type}`,
          }, action.notify));
        }
        continue;
      }

      if (!limiter.tryAcquire(signal.repo)) {
        emit(`[gstack-watch] rate/concurrency limit hit; deferring ${skill} (${name})`);
        fileOk = false;
        continue;
      }

      try {
        const result = cfg.executorOverride
          ? await cfg.executorOverride(action, signal.repo)
          : await executor.run(action, signal.repo);
        if (result.error) {
          // Executor-level failure (spawn error, timeout): the action never ran
          // to completion, so keep the file for the next pass.
          emit(formatNotification({
            kind: "action-failed", rule_id: action.rule_id, skill,
            error: result.error,
          }, action.notify));
          fileOk = false;
        } else {
          // Completed run — nonzero exit is a skill outcome, not a transport
          // failure; notify and consume the file (no infinite retry).
          emit(formatNotification({
            kind: "auto-run-complete", rule_id: action.rule_id, skill,
            finding_count: result.finding_count, exit_code: result.exit_code,
          }, action.notify));
        }
      } catch (err) {
        emit(formatNotification({
          kind: "action-failed", rule_id: action.rule_id, skill,
          error: String((err as Error)?.message ?? err),
        }, action.notify));
        fileOk = false;
      } finally {
        limiter.release(signal.repo);
      }
    }

    if (fileOk) {
      try { unlinkSync(filePath); } catch {}
      summary.processed++;
    } else {
      summary.deferred++;
    }
  }

  return summary;
}
