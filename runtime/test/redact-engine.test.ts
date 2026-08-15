import { describe, expect, test } from "bun:test";
import { createRedactEngine } from "../src/redact/engine";
import type { RuntimeSignal } from "../src/types";

const sampleSignal = (message: string): RuntimeSignal => ({
  type: "log", provider: "test", timestamp: "2026-05-16T12:00:00Z",
  severity: "info", message, raw_link: "x", metadata: { extra: message },
});

describe("redact engine", () => {
  test("redacts email in message + metadata", async () => {
    const eng = await createRedactEngine(["email"]);
    const s = eng.redactSignal(sampleSignal("user alice@example.com logged in"));
    expect(s.message).toBe("user <email> logged in");
    expect(s.metadata.extra).toBe("user <email> logged in");
  });

  test("redacts national_id_ksa", async () => {
    const eng = await createRedactEngine(["national_id_ksa"]);
    const s = eng.redactSignal(sampleSignal("tenant id 1234567890 not found"));
    expect(s.message).toContain("<national_id_ksa>");
    expect(s.message).not.toContain("1234567890");
  });

  test("composes multiple patterns", async () => {
    const eng = await createRedactEngine(["email", "phone_ksa"]);
    const s = eng.redactSignal(sampleSignal("contact alice@example.com or +966512345678"));
    expect(s.message).toBe("contact <email> or <phone_ksa>");
  });

  test("redactArray applies to each signal", async () => {
    const eng = await createRedactEngine(["email"]);
    const out = eng.redactArray([
      sampleSignal("a@a.com"),
      sampleSignal("b@b.com"),
    ]);
    expect(out[0].message).toBe("<email>");
    expect(out[1].message).toBe("<email>");
  });

  test("empty patterns is identity", async () => {
    const eng = await createRedactEngine([]);
    const s = eng.redactSignal(sampleSignal("alice@example.com 1234567890"));
    expect(s.message).toBe("alice@example.com 1234567890");
  });
});
