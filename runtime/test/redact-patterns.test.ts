import { describe, expect, test } from "bun:test";
import { loadPattern, loadBuiltinPatterns } from "../src/redact/patterns";

describe("redact pattern loader", () => {
  test("loads built-in email pattern", async () => {
    const p = await loadPattern("email");
    expect(p.name).toBe("email");
    expect(p.regex.test("alice@example.com")).toBe(true);
  });

  test("loads built-in national_id_ksa", async () => {
    const p = await loadPattern("national_id_ksa");
    // Regex has /g flag — reset lastIndex between independent checks.
    p.regex.lastIndex = 0;
    expect(p.regex.test("1234567890")).toBe(true);
    p.regex.lastIndex = 0;
    expect(p.regex.test("2345678901")).toBe(true);
    p.regex.lastIndex = 0;
    expect(p.regex.test("9234567890")).toBe(false);
  });

  test("loadBuiltinPatterns returns all 6", async () => {
    const all = await loadBuiltinPatterns();
    const names = all.map(p => p.name).sort();
    expect(names).toEqual(["credit_card", "email", "iban_sa", "jwt", "national_id_ksa", "phone_ksa"]);
  });

  test("loadPattern throws on unknown pattern", async () => {
    await expect(loadPattern("nonexistent")).rejects.toThrow(/not found/);
  });
});
