import { describe, expect, test } from "bun:test";
import { parseHealthOutput } from "../src/primitives/health-score";

describe("health-score parser", () => {
  test("parses code/8 prod/6 format", () => {
    const out = parseHealthOutput("Overall: code 8/10, prod 6/10\n", "both");
    expect(out.kind).toBe("score");
    expect(out.kind === "score" && out.value).toBe(7);
    expect(out.kind === "score" && out.details).toMatchObject({ code: 8, prod: 6 });
  });
  test("falls back to NaN-safe 0 on unparseable", () => {
    const out = parseHealthOutput("garbage", "code");
    expect(out.kind).toBe("score");
    expect(out.kind === "score" && out.value).toBe(0);
  });
});
