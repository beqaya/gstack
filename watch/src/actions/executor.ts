import { spawn } from "node:child_process";
import { createLogWriter } from "../log";
import type { ResolvedAction } from "../rules/engine";
import type { ActionResult } from "../types";

const STDOUT_LIMIT = 64 * 1024;
const STDERR_LIMIT = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TRAIL_MARKER = "\n[...truncated...]";

export interface ExecutorConfig {
  logDir: string;
  timeoutMs?: number;
  /** Override for testing — defaults to spawning real Claude Code subprocess. */
  skillRunner?: (skill: string, args: string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface Executor {
  run(action: ResolvedAction, repo: string): Promise<ActionResult>;
}

export function createExecutor(cfg: ExecutorConfig): Executor {
  const log = createLogWriter(cfg.logDir);
  const runner = cfg.skillRunner ?? defaultRunner(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return {
    async run(action, repo): Promise<ActionResult> {
      // action.action is the discriminated union — narrow to auto-run/suggest before reading .skill
      if (action.action.type !== "auto-run" && action.action.type !== "suggest") {
        throw new Error(`executor: cannot run action of type ${action.action.type} (expected auto-run/suggest)`);
      }
      const skill = action.action.skill;
      const args = action.action.args ?? [];
      const started_at = new Date().toISOString();

      let result: ActionResult;
      try {
        const out = await runner(skill, args, repo);
        result = {
          action_id: action.action_id, rule_id: action.rule_id,
          skill, args,
          started_at, ended_at: new Date().toISOString(),
          exit_code: out.exitCode,
          stdout_truncated: truncate(out.stdout, STDOUT_LIMIT),
          stderr_truncated: truncate(out.stderr, STDERR_LIMIT),
        };
      } catch (err: any) {
        result = {
          action_id: action.action_id, rule_id: action.rule_id,
          skill, args,
          started_at, ended_at: new Date().toISOString(),
          exit_code: -1,
          stdout_truncated: "",
          error: String(err?.message ?? err),
        };
      }
      await log.write({ kind: "action_result", repo, ...result });
      return result;
    },
  };
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + TRAIL_MARKER;
}

function defaultRunner(timeoutMs: number) {
  return async (skill: string, args: string[], cwd: string) => {
    // Phase 1: spawn `claude` CLI with the skill name. Adjust to gstack's actual invocation form.
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn("claude", ["--skill", skill, ...args], { cwd });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 30_000);
        reject(new Error(`action timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on("data", d => (stdout += d.toString()));
      child.stderr.on("data", d => (stderr += d.toString()));
      child.on("close", code => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
      child.on("error", err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };
}
