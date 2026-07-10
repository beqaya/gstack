import { describe, expect, test } from "bun:test";
import { validateRange } from "../src/primitives/git-log";

describe("git range validator", () => {
  test("accepts simple ranges", () => {
    expect(validateRange("HEAD~10..HEAD")).toBe(true);
    expect(validateRange("main..feature")).toBe(true);
    expect(validateRange("abc123..def456")).toBe(true);
  });
  test("rejects shell metacharacters", () => {
    expect(validateRange("HEAD; rm")).toBe(false);
    expect(validateRange("`whoami`")).toBe(false);
    expect(validateRange("$(echo)")).toBe(false);
  });
  test("undefined range is allowed (treated as 'HEAD')", () => {
    expect(validateRange(undefined)).toBe(true);
  });
});
