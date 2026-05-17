import { loadDefaultRules } from "./rules/loader";
import { createRuleEngine, type ResolvedAction } from "./rules/engine";
import { createLimiter } from "./actions/limiter";
import { createExecutor } from "./actions/executor";
import { emit, formatNotification } from "./notify/terminal";
import { createSocketServer, type SocketServer } from "./signals/socket";
import { createFileWatcher, type FileWatcher } from "./signals/file-watcher";
import { startDailyScheduler, type Scheduler } from "./signals/scheduler";
import { watchLogDir } from "./paths";
import type { ActionResult, RepoState, Signal } from "./types";

export interface DaemonConfig {
  repos: string[];
  socketPath: string | null;
  enableFileWatcher: boolean;
  enableScheduler: boolean;
  dailyHealthTime?: string;
  maxConcurrent?: number;
  maxActionsPerHour?: number;
  /** Test seam: bypass real Claude subprocess. */
  executorOverride?: (action: ResolvedAction, repo: string) => Promise<ActionResult>;
}

export interface DaemonHandle {
  injectSignal(s: Signal): Promise<void>;
  stop(): Promise<void>;
}

async function getRepoState(_repo: string): Promise<RepoState> {
  // Phase 1 minimal: hardcode safe defaults. A proper git inspection helper lands later.
  return {
    branch: "unknown", branchAgeHours: 0, hasDiff: false,
    isDefaultBranch: false, recentActions: [],
  };
}

export async function startDaemon(cfg: DaemonConfig): Promise<DaemonHandle> {
  const rules = await loadDefaultRules();
  const engine = createRuleEngine(rules);
  const limiter = createLimiter({
    maxConcurrent: cfg.maxConcurrent ?? 3,
    maxActionsPerHour: cfg.maxActionsPerHour ?? 30,
  });
  const executor = createExecutor({ logDir: watchLogDir() });

  let socketSrv: SocketServer | null = null;
  let fileWatcher: FileWatcher | null = null;
  let scheduler: Scheduler | null = null;

  async function handleSignal(sig: Signal) {
    const repoState = await getRepoState(sig.repo);
    const actions = engine.evaluate(sig, repoState);
    for (const action of actions) {
      // Narrow the discriminated union once for use throughout the loop body.
      const isRunnable =
        action.action.type === "auto-run" || action.action.type === "suggest";
      const skill = isRunnable ? action.action.skill : "(unknown)";

      if (action.action.type !== "auto-run") {
        if (action.action.type === "suggest") {
          emit(formatNotification({
            kind: "suggestion",
            rule_id: action.rule_id,
            skill,
            reason: `signal ${sig.type}`,
          }, action.notify));
        }
        // notify / record types are no-ops in Phase 1 beyond what the engine already did.
        continue;
      }

      if (!limiter.tryAcquire(sig.repo)) {
        emit(`[watch] rate/concurrency limit hit; deferring ${skill}`);
        continue;
      }

      try {
        const result = cfg.executorOverride
          ? await cfg.executorOverride(action, sig.repo)
          : await executor.run(action, sig.repo);
        emit(formatNotification({
          kind: "auto-run-complete",
          rule_id: action.rule_id,
          skill,
          finding_count: result.finding_count,
          exit_code: result.exit_code,
        }, action.notify));
      } catch (err) {
        emit(formatNotification({
          kind: "action-failed",
          rule_id: action.rule_id,
          skill,
          error: String((err as Error)?.message ?? err),
        }, action.notify));
      } finally {
        limiter.release(sig.repo);
      }
    }
  }

  if (cfg.socketPath) {
    socketSrv = await createSocketServer(cfg.socketPath, handleSignal);
  }
  if (cfg.enableFileWatcher && cfg.repos[0]) {
    fileWatcher = await createFileWatcher(cfg.repos[0], handleSignal);
  }
  if (cfg.enableScheduler) {
    scheduler = startDailyScheduler(cfg.dailyHealthTime ?? "09:00", cfg.repos, handleSignal);
  }

  return {
    async injectSignal(s) { await handleSignal(s); },
    async stop() {
      await socketSrv?.close();
      await fileWatcher?.close();
      scheduler?.close();
    },
  };
}
