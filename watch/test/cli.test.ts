import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli";

describe("gstack-watch CLI arg parsing", () => {
  test("drain", () => {
    expect(parseArgs(["drain"])).toEqual({ command: "drain", repo: undefined, limit: undefined });
  });

  test("status with --limit", () => {
    expect(parseArgs(["status", "--limit", "5"])).toEqual({ command: "status", repo: undefined, limit: 5 });
  });

  test("install-hooks with repo path", () => {
    expect(parseArgs(["install-hooks", "/some/repo"])).toEqual({
      command: "install-hooks", repo: "/some/repo", limit: undefined,
    });
  });

  test("uninstall-hooks without repo path", () => {
    expect(parseArgs(["uninstall-hooks"]).command).toBe("uninstall-hooks");
  });

  test("rejects unknown command (start/stop are gone with the daemon)", () => {
    expect(() => parseArgs(["start"])).toThrow(/unknown command/);
    expect(() => parseArgs(["stop"])).toThrow(/unknown command/);
    expect(() => parseArgs([])).toThrow(/unknown command/);
  });

  test("rejects unknown flags and extra positionals", () => {
    expect(() => parseArgs(["drain", "--nope"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["install-hooks", "/a", "/b"])).toThrow(/unexpected argument/);
  });
});
