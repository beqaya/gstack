/**
 * Pattern source for runtime's streaming redactor.
 *
 * The pattern DEFINITIONS live in lib/redact-patterns.ts — the repo's single
 * redaction taxonomy — so runtime can never drift from what /spec, /ship, and
 * the redact CLI consider sensitive. This module only maps runtime's
 * config-facing pattern names (kept stable for existing observability.yaml
 * files) onto lib pattern ids and adapts them to a streaming shape.
 * The old per-pattern YAML files under builtin/ are gone with it.
 */
import { PATTERNS, type RedactPattern as LibPattern } from "../../../lib/redact-patterns";

export interface RedactPattern {
  name: string;
  lib: LibPattern;
}

/** runtime config name -> lib/redact-patterns id */
const NAME_TO_LIB_ID: Record<string, string> = {
  email: "pii.email",
  phone_ksa: "pii.phone.ksa",
  national_id_ksa: "pii.national_id_ksa",
  iban_sa: "pii.iban_sa",
  credit_card: "pii.cc",
  jwt: "jwt",
};

export function availablePatternNames(): string[] {
  return Object.keys(NAME_TO_LIB_ID);
}

export async function loadPattern(name: string): Promise<RedactPattern> {
  const libId = NAME_TO_LIB_ID[name];
  if (!libId) {
    throw new Error(
      `unknown redact pattern "${name}" (available: ${availablePatternNames().join(", ")})`,
    );
  }
  const lib = PATTERNS.find((p) => p.id === libId);
  if (!lib) throw new Error(`lib/redact-patterns has no pattern with id "${libId}"`);
  return { name, lib };
}
