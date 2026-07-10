import type { TimeWindow } from "../types";

const SUPPORTED_PROVIDERS_PHASE1 = ["gcp"];

export function parseWindowArg(arg: string, now: Date = new Date()): TimeWindow {
  const m = /^(\d+)([hd])$/.exec(arg);
  if (!m) throw new Error(`invalid --window: ${arg}; expected NhN or Nd (e.g., 24h, 7d)`);
  const num = parseInt(m[1], 10);
  const unitMs = m[2] === "h" ? 3600_000 : 86_400_000;
  const start = new Date(now.getTime() - num * unitMs);
  return { start: start.toISOString(), end: now.toISOString() };
}

export function parseProvidersArg(arg: string): string[] {
  if (arg === "all") return [...SUPPORTED_PROVIDERS_PHASE1];
  const requested = arg.split(",").map(s => s.trim()).filter(Boolean);
  return requested.filter(p => SUPPORTED_PROVIDERS_PHASE1.includes(p));
}
