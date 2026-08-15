import { describe, expect, test } from "bun:test";
import { runProdQuery, isProdQueryAvailable } from "../src/primitives/prod-query";

describe("prod_query primitive (stub)", () => {
  test("isProdQueryAvailable returns a boolean", async () => {
    const available = await isProdQueryAvailable();
    expect(typeof available).toBe("boolean");
  });

  test("runProdQuery throws clear error when stubbed", async () => {
    await expect(runProdQuery(
      { op: "prod_query", provider: "gcp", query: { kind: "errors", window: "1h" } },
      { cwd: "/tmp", forceStub: true },
    )).rejects.toThrow(/gstack-runtime/);
  });
});
