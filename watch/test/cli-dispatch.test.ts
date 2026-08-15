import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/index";

describe("CLI dispatch parser", () => {
  test("parses 'start' with repo paths", () => {
    expect(parseArgs(["start", "/a", "/b"])).toEqual({
      command: "start", repos: ["/a", "/b"], limit: undefined,
    });
  });
  test("parses 'stop'", () => {
    expect(parseArgs(["stop"])).toEqual({ command: "stop", repos: [], limit: undefined });
  });
  test("parses 'tail --limit 100'", () => {
    expect(parseArgs(["tail", "--limit", "100"])).toEqual({
      command: "tail", repos: [], limit: 100,
    });
  });
  test("rejects unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow();
  });
});
