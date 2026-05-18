import { describe, expect, test } from "bun:test";
import { formatHealthReport } from "../src/cli/test";

describe("health report formatter", () => {
  test("ok health", () => {
    const out = formatHealthReport({
      ok: true, provider: "gcp", last_check: "2026-05-16T12:00:00Z",
      auth_present: true, region: "me-central-2", message: "ok",
    });
    expect(out).toContain("✓ gcp");
    expect(out).toContain("me-central-2");
  });

  test("not ok health includes error", () => {
    const out = formatHealthReport({
      ok: false, provider: "gcp", last_check: "x",
      auth_present: false, message: "no credentials",
    });
    expect(out).toContain("✗ gcp");
    expect(out).toContain("no credentials");
  });
});
