import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/index";

describe("synth CLI dispatcher", () => {
  test("parses bare synth with quoted goal", () => {
    const a = parseArgs(["synth", "find all TODOs"]);
    expect(a).toEqual({ command: "synth", goal: "find all TODOs", mode: "plan-only", planId: undefined });
  });

  test("parses --mode execute", () => {
    const a = parseArgs(["synth", "x", "--mode", "execute"]);
    expect(a.mode).toBe("execute");
  });

  test("parses replay <id>", () => {
    const a = parseArgs(["replay", "p_abc"]);
    expect(a).toEqual({ command: "replay", goal: undefined, mode: "plan-only", planId: "p_abc" });
  });

  test("parses eval", () => {
    const a = parseArgs(["eval"]);
    expect(a.command).toBe("eval");
  });

  test("rejects unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow();
  });
});
