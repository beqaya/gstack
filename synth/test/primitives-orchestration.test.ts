import { describe, expect, test } from "bun:test";
import { runParallel } from "../src/primitives/parallel";
import { runSequential } from "../src/primitives/sequential";
import type { PrimitiveOutput } from "../src/types";

describe("orchestration primitives", () => {
  test("parallel runs refs concurrently and combines outputs", async () => {
    const results = new Map<string, PrimitiveOutput>([
      ["a", { kind: "text", value: "1" }],
      ["b", { kind: "text", value: "2" }],
    ]);
    const out = await runParallel(
      { op: "parallel", steps: [{ ref: "a" }, { ref: "b" }] },
      { resolveRef: async (ref) => results.get(ref)! },
    );
    expect(out.kind).toBe("json");
    if (out.kind === "json") {
      const v = out.value as Record<string, PrimitiveOutput>;
      expect(v.a.kind === "text" && v.a.value).toBe("1");
      expect(v.b.kind === "text" && v.b.value).toBe("2");
    }
  });

  test("sequential runs refs in order, threading prior outputs", async () => {
    const calls: string[] = [];
    const out = await runSequential(
      { op: "sequential", steps: [{ ref: "a" }, { ref: "b" }, { ref: "c" }] },
      { resolveRef: async (ref): Promise<PrimitiveOutput> => { calls.push(ref); return { kind: "text", value: ref }; } },
    );
    expect(calls).toEqual(["a", "b", "c"]);
    expect(out.kind).toBe("json");
  });

  test("parallel propagates a sub-step failure", async () => {
    await expect(runParallel(
      { op: "parallel", steps: [{ ref: "ok" }, { ref: "boom" }] },
      { resolveRef: async (ref): Promise<PrimitiveOutput> => {
          if (ref === "boom") throw new Error("nope");
          return { kind: "text", value: "ok" };
      } },
    )).rejects.toThrow(/nope/);
  });
});
