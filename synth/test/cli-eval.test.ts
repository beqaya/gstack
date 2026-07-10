import { describe, expect, test } from "bun:test";
import { formatEvalReport } from "../src/cli/eval";

describe("eval report formatter", () => {
  test("renders pass/fail counts", () => {
    const out = formatEvalReport([
      { id: "g01", ok: true, reasons: [] },
      { id: "g02", ok: false, reasons: ["missing grep"] },
      { id: "g03", ok: true, reasons: [] },
    ]);
    expect(out).toContain("2 / 3 passed");
    expect(out).toContain("g02");
    expect(out).toContain("missing grep");
  });
});
