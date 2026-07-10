import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { synthRoot, synthLogDir, synthTemplatesDir, planLogPath } from "../src/paths";

describe("synth paths", () => {
  test("synthRoot is ~/.gstack/synth", () => {
    expect(synthRoot()).toBe(join(homedir(), ".gstack", "synth"));
  });
  test("synthLogDir is under root", () => {
    expect(synthLogDir()).toBe(join(homedir(), ".gstack", "synth", "log"));
  });
  test("synthTemplatesDir is under root", () => {
    expect(synthTemplatesDir()).toBe(join(homedir(), ".gstack", "synth", "templates"));
  });
  test("planLogPath builds per-plan path", () => {
    expect(planLogPath("p_abc")).toBe(join(homedir(), ".gstack", "synth", "log", "p_abc.jsonl"));
  });
});
