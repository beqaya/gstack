/**
 * Streaming redactor over lib/redact-patterns definitions.
 *
 * lib/redact-engine's scan/applyRedactions is a gating API (finding ids,
 * structural guards, diff previews) built for document egress; prod log
 * scrubbing needs a plain string -> string pass over many entries. This
 * applier keeps that shape but honors each lib pattern's `validate` hook,
 * so e.g. a 10-digit epoch is NOT eaten by the national-id pattern.
 */
import type { RuntimeSignal } from "../types";
import { loadPattern, type RedactPattern } from "./patterns";

export interface RedactEngine {
  redactString(s: string): string;
  redactSignal(s: RuntimeSignal): RuntimeSignal;
  redactArray(arr: RuntimeSignal[]): RuntimeSignal[];
}

function applyOne(s: string, p: RedactPattern): string {
  const src = p.lib.regex;
  const flags = src.flags.includes("g") ? src.flags : src.flags + "g";
  const re = new RegExp(src.source, flags);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const span = m[1] ?? m[0];
    let ok = true;
    if (p.lib.validate) {
      try {
        ok = p.lib.validate(span, m);
      } catch {
        ok = false; // a throwing validator must never redact on faith
      }
    }
    if (ok && span) {
      const start = m.index + m[0].indexOf(span);
      out += s.slice(last, start) + (p.lib.redactToken ?? `<${p.name}>`);
      last = start + span.length;
    }
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width safety
  }
  return out + s.slice(last);
}

export async function createRedactEngine(patternNames: string[]): Promise<RedactEngine> {
  const patterns: RedactPattern[] = await Promise.all(patternNames.map((n) => loadPattern(n)));

  function redactString(s: string): string {
    let out = s;
    for (const p of patterns) out = applyOne(out, p);
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
