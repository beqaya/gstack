import { describe, expect, test } from "bun:test";
import { parseWindowArg, parseProvidersArg } from "../src/cli/fetch";

describe("fetch CLI args", () => {
  test("parses --window 24h", () => {
    const w = parseWindowArg("24h", new Date("2026-05-16T12:00:00Z"));
    expect(w.end).toBe("2026-05-16T12:00:00.000Z");
    expect(w.start).toBe("2026-05-15T12:00:00.000Z");
  });

  test("parses --window 1h", () => {
    const w = parseWindowArg("1h", new Date("2026-05-16T12:00:00Z"));
    expect(w.start).toBe("2026-05-16T11:00:00.000Z");
  });

  test("rejects malformed window", () => {
    expect(() => parseWindowArg("foo", new Date())).toThrow();
  });

  test("parses --providers all", () => {
    expect(parseProvidersArg("all")).toEqual(["gcp"]);
  });

  test("parses comma-separated providers", () => {
    expect(parseProvidersArg("gcp,sentry")).toEqual(["gcp"]);
  });
});
