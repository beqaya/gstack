import { describe, expect, test } from "bun:test";
import { msUntilNextDaily } from "../src/signals/scheduler";

describe("daily scheduler timing", () => {
  test("when current time is before HH:MM today, schedules for today", () => {
    const now = new Date("2026-05-16T08:00:00");
    const ms = msUntilNextDaily("09:00", now);
    expect(ms).toBe(60 * 60 * 1000);
  });

  test("when current time is after HH:MM, schedules for tomorrow", () => {
    const now = new Date("2026-05-16T10:00:00");
    const ms = msUntilNextDaily("09:00", now);
    expect(ms).toBe(23 * 60 * 60 * 1000);
  });

  test("rejects malformed HH:MM", () => {
    expect(() => msUntilNextDaily("9:00", new Date())).toThrow();
    expect(() => msUntilNextDaily("25:00", new Date())).toThrow();
  });
});
