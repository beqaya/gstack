export type SignalSource = "git" | "file" | "time" | "ci";

export interface Signal {
  id: string;
  source: SignalSource;
  type: string;                    // e.g., "post-commit", "post-merge", "file-changed", "daily"
  repo: string;                    // absolute path to repo root
  timestamp: string;               // ISO 8601 UTC
  metadata: Record<string, unknown>;
}

export interface RepoState {
  branch: string;
  branchAgeHours: number;
  hasDiff: boolean;
  isDefaultBranch: boolean;
  recentActions: { skill: string; ts: string }[];
}

export type ActionType = "auto-run" | "suggest" | "notify" | "record";

export type Action =
  | { type: "auto-run" | "suggest"; skill: string; args?: string[] }
  | { type: "notify" | "record" };

export type NotifyPolicy =
  | "off"
  | "terminal-only-on-finding"
  | "terminal"
  | "system"
  | "terminal+system";

export interface Rule {
  id: string;
  on: { source: SignalSource; type: string };
  when?: Record<string, unknown>;
  action: Action;
  notify: NotifyPolicy;
  record?: boolean;
}

/** JSONL wire format — snake_case keys are intentional for log compatibility. */
export interface ActionResult {
  action_id: string;
  rule_id: string;
  skill: string;
  args: string[];
  started_at: string;
  ended_at: string;
  exit_code: number;
  stdout_truncated: string;        // max 64 KB
  stderr_truncated?: string;       // max 16 KB
  finding_count?: number;          // parsed from stdout if skill emits it
  error?: string;                  // present if action failed before/during exec
}

export interface WatchConfig {
  webhookPort?: number;            // Phase 1: unused; reserved for Phase 2
  maxConcurrent: number;           // default 3
  maxActionsPerHour: number;       // default 30
  actionTimeoutMs: number;         // default 300000 (5 min)
  dailyHealthTime: string;         // "HH:MM" local; default "09:00"
}
