import { describe, expect, test } from "bun:test";
import { createLimiter } from "../src/actions/limiter";

describe("action limiter", () => {
  test("rejects when concurrent slot unavailable", () => {
    const lim = createLimiter({ maxConcurrent: 2, maxActionsPerHour: 100 });
    expect(lim.tryAcquire("/r")).toBe(true);
    expect(lim.tryAcquire("/r")).toBe(true);
    expect(lim.tryAcquire("/r")).toBe(false);  // 3rd rejected
    lim.release("/r");
    expect(lim.tryAcquire("/r")).toBe(true);   // freed
  });

  test("rejects when hourly rate exceeded for the repo", () => {
    const lim = createLimiter({ maxConcurrent: 100, maxActionsPerHour: 3 });
    for (let i = 0; i < 3; i++) {
      expect(lim.tryAcquire("/r")).toBe(true);
      lim.release("/r");
    }
    expect(lim.tryAcquire("/r")).toBe(false);
  });

  test("per-repo isolation", () => {
    const lim = createLimiter({ maxConcurrent: 1, maxActionsPerHour: 2 });
    expect(lim.tryAcquire("/r1")).toBe(true);
    expect(lim.tryAcquire("/r2")).toBe(true);
    expect(lim.tryAcquire("/r1")).toBe(false); // /r1 at concurrency cap
  });
});
