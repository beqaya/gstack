import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/index";

describe("runtime CLI dispatch parser", () => {
  test("parses 'configure gcp <token>'", () => {
    const a = parseArgs(["configure", "gcp", "tok123"]);
    expect(a.command).toBe("configure");
    expect(a.provider).toBe("gcp");
    expect(a.credential).toBe("tok123");
    expect(a.providers).toEqual([]);
    expect(a.window).toBeUndefined();
  });

  test("parses 'test gcp'", () => {
    const a = parseArgs(["test", "gcp"]);
    expect(a.command).toBe("test");
    expect(a.provider).toBe("gcp");
    expect(a.credential).toBeUndefined();
  });

  test("parses 'fetch --providers all --window 24h'", () => {
    const a = parseArgs(["fetch", "--providers", "all", "--window", "24h"]);
    expect(a.command).toBe("fetch");
    expect(a.providers).toEqual(["gcp"]);
    expect(a.window).toBeDefined();
    expect(typeof a.window?.end).toBe("string");
  });

  test("rejects unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow();
  });
});
