import { describe, expect, test } from "bun:test";
import { assertRegion, isRegionGcpResource } from "../src/adapters/gcp/region-lock";

describe("region lock", () => {
  test("permits matching region resource", () => {
    expect(() => assertRegion("me-central-2", "projects/lezam/locations/me-central-2/services/api", true)).not.toThrow();
  });

  test("rejects mismatched region when lock is on", () => {
    expect(() => assertRegion("me-central-2", "projects/lezam/locations/us-central1/services/api", true))
      .toThrow(/region lock/);
  });

  test("permits mismatched region when lock is off", () => {
    expect(() => assertRegion("me-central-2", "projects/lezam/locations/us-central1/services/api", false))
      .not.toThrow();
  });

  test("isRegionGcpResource matches GCP region strings", () => {
    expect(isRegionGcpResource("me-central-2")).toBe(true);
    expect(isRegionGcpResource("us-east1")).toBe(true);
    expect(isRegionGcpResource("not-a-region")).toBe(false);
  });
});
