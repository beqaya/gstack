import { describe, expect, test } from "bun:test";
import { computeStopAction } from "../src/cli/stop";

describe("stop action resolution", () => {
  test("no pid file → no-action", () => {
    expect(computeStopAction(null, () => true)).toEqual({ kind: "no-pid-file" });
  });

  test("pid file exists but process is dead → stale", () => {
    expect(computeStopAction(12345, () => false)).toEqual({ kind: "stale", pid: 12345 });
  });

  test("pid file exists and alive → kill", () => {
    expect(computeStopAction(12345, () => true)).toEqual({ kind: "kill", pid: 12345 });
  });
});
