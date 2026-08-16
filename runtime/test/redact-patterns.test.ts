import { describe, expect, test } from "bun:test";
import { loadPattern, availablePatternNames } from "../src/redact/patterns";

// Patterns are sourced from lib/redact-patterns (the repo's single redaction
// taxonomy) via a name->id map; these tests pin the mapping, not the regexes.
describe("redact pattern loader", () => {
  test("loads email as lib's pii.email", async () => {
    const p = await loadPattern("email");
    expect(p.name).toBe("email");
    expect(p.lib.id).toBe("pii.email");
    expect(new RegExp(p.lib.regex.source).test("alice@example.com")).toBe(true);
  });

  test("national_id_ksa only matches 10 digits starting 1 or 2", async () => {
    const p = await loadPattern("national_id_ksa");
    expect(new RegExp(p.lib.regex.source).test("1234567890")).toBe(true);
    expect(new RegExp(p.lib.regex.source).test("2345678901")).toBe(true);
    expect(new RegExp(p.lib.regex.source).test("9234567890")).toBe(false);
  });

  test("every config-facing name resolves to a lib pattern", async () => {
    const names = availablePatternNames().sort();
    expect(names).toEqual(["credit_card", "email", "iban_sa", "jwt", "national_id_ksa", "phone_ksa"]);
    for (const n of names) {
      const p = await loadPattern(n);
      expect(p.lib.regex).toBeInstanceOf(RegExp);
    }
  });

  test("loadPattern throws on unknown pattern", async () => {
    await expect(loadPattern("nonexistent")).rejects.toThrow(/unknown redact pattern/);
  });
});
