import { describe, expect, test } from "bun:test";
import { backoffMs } from "../src/supervisor";

describe("supervisor backoff", () => {
  test("starts at 1s and doubles up to 60s cap", () => {
    expect(backoffMs(0)).toBe(1_000);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(5)).toBe(32_000);
    expect(backoffMs(6)).toBe(60_000);  // capped
    expect(backoffMs(20)).toBe(60_000); // still capped
  });
});
