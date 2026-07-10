import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { runtimeRoot, runtimeCacheDir, runtimeSecretsFallbackDir } from "../src/paths";

describe("runtime paths", () => {
  test("runtimeRoot is ~/.gstack/runtime", () => {
    expect(runtimeRoot()).toBe(join(homedir(), ".gstack", "runtime"));
  });
  test("runtimeCacheDir is under root", () => {
    expect(runtimeCacheDir()).toBe(join(homedir(), ".gstack", "runtime", "cache"));
  });
  test("runtimeSecretsFallbackDir is under root", () => {
    expect(runtimeSecretsFallbackDir()).toBe(join(homedir(), ".gstack", "runtime", "secrets-fallback"));
  });
});
