import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadObservabilityConfig, validateObservabilityConfig } from "../src/config";

describe("observability config", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "obs-cfg-")); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  test("loads from .claude/observability.yaml", async () => {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "observability.yaml"), `
observability:
  primary: gcp
  project_id: lezam-prod
  region: me-central-2
  region_lock: true
  secondary: []
  providers:
    gcp:
      services: ["api"]
  redact_patterns:
    - email
`);
    const cfg = await loadObservabilityConfig(repo);
    expect(cfg!.primary).toBe("gcp");
    expect(cfg!.region_lock).toBe(true);
    expect(cfg!.redact_patterns).toEqual(["email"]);
  });

  test("falls back to CLAUDE.md observability block", async () => {
    writeFileSync(join(repo, "CLAUDE.md"), [
      "# Lezam",
      "",
      "```yaml",
      "observability:",
      "  primary: gcp",
      "  project_id: lezam-prod",
      "  region: me-central-2",
      "  region_lock: true",
      "  secondary: []",
      "  providers:",
      "    gcp: {}",
      "  redact_patterns: [email]",
      "```",
    ].join("\n"));
    const cfg = await loadObservabilityConfig(repo);
    expect(cfg!.primary).toBe("gcp");
  });

  test("validation rejects region_lock=true without region", () => {
    expect(() => validateObservabilityConfig({
      primary: "gcp", project_id: "x", region: "", region_lock: true,
      secondary: [], providers: {}, redact_patterns: [],
    } as never)).toThrow(/region.*required.*region_lock/);
  });

  test("returns null when no config found", async () => {
    expect(await loadObservabilityConfig(repo)).toBeNull();
  });
});
