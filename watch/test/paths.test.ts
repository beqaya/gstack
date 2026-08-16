import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { gstackDataDir, watchDeadDir, watchInboxDir, watchLogDir } from "../src/paths";

describe("watch paths", () => {
  let savedHome: string | undefined;
  beforeEach(() => { savedHome = process.env.GSTACK_HOME; delete process.env.GSTACK_HOME; });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.GSTACK_HOME;
    else process.env.GSTACK_HOME = savedHome;
  });

  test("gstackDataDir resolves to ~/.gstack by default", () => {
    expect(gstackDataDir()).toBe(join(homedir(), ".gstack"));
  });

  test("gstackDataDir honors GSTACK_HOME override at call time", () => {
    process.env.GSTACK_HOME = join("C:", "tmp", "gstack-test-home");
    expect(gstackDataDir()).toBe(join("C:", "tmp", "gstack-test-home"));
  });

  test("watchLogDir is under gstackDataDir", () => {
    expect(watchLogDir()).toBe(join(homedir(), ".gstack", "watch", "log"));
  });

  test("watchInboxDir and watchDeadDir live under watch root", () => {
    expect(watchInboxDir()).toBe(join(homedir(), ".gstack", "watch", "inbox"));
    expect(watchDeadDir()).toBe(join(homedir(), ".gstack", "watch", "dead"));
  });

  test("inbox/dead follow the GSTACK_HOME override", () => {
    process.env.GSTACK_HOME = join("C:", "tmp", "other-home");
    expect(watchInboxDir()).toBe(join("C:", "tmp", "other-home", "watch", "inbox"));
    expect(watchDeadDir()).toBe(join("C:", "tmp", "other-home", "watch", "dead"));
  });
});
