import type { NotifyPolicy } from "../types";

export type NotificationEvent =
  | { kind: "auto-run-complete"; rule_id: string; skill: string; finding_count?: number; exit_code: number }
  | { kind: "suggestion"; rule_id: string; skill: string; reason: string }
  | { kind: "action-failed"; rule_id: string; skill: string; error: string };

export function formatNotification(ev: NotificationEvent, policy: NotifyPolicy = "terminal"): string {
  if (policy === "off") return "";

  if (ev.kind === "auto-run-complete") {
    if (policy === "terminal-only-on-finding" && (ev.finding_count ?? 0) === 0) return "";
    const findings = ev.finding_count ?? 0;
    const status = ev.exit_code === 0 ? "✓" : "✗";
    return `[gstack-watch] ${status} ${ev.skill} (${ev.rule_id}) — ${findings} finding${findings === 1 ? "" : "s"}`;
  }
  if (ev.kind === "suggestion") {
    return `[gstack-watch] 💡 suggestion: ${ev.skill} — ${ev.reason} (${ev.rule_id})`;
  }
  return `[gstack-watch] ✗ ${ev.skill} failed (${ev.rule_id}): ${ev.error}`;
}

export function emit(line: string): void {
  if (line) process.stdout.write(line + "\n");
}
