import type { RuntimeSignal } from "../types";
import { loadPattern, type RedactPattern } from "./patterns";

export interface RedactEngine {
  redactString(s: string): string;
  redactSignal(s: RuntimeSignal): RuntimeSignal;
  redactArray(arr: RuntimeSignal[]): RuntimeSignal[];
}

export async function createRedactEngine(patternNames: string[]): Promise<RedactEngine> {
  const patterns: RedactPattern[] = await Promise.all(patternNames.map(n => loadPattern(n)));

  function redactString(s: string): string {
    let out = s;
    for (const p of patterns) {
      p.regex.lastIndex = 0;
      out = out.replace(p.regex, p.replacement);
    }
    return out;
  }

  function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") out[k] = redactString(v);
      else if (Array.isArray(v)) out[k] = v.map(x => typeof x === "string" ? redactString(x) : x);
      else if (v && typeof v === "object") out[k] = redactObject(v as Record<string, unknown>);
      else out[k] = v;
    }
    return out;
  }

  function redactSignal(s: RuntimeSignal): RuntimeSignal {
    return {
      ...s,
      message: redactString(s.message),
      metadata: redactObject(s.metadata),
    };
  }

  return {
    redactString,
    redactSignal,
    redactArray(arr) { return arr.map(redactSignal); },
  };
}
