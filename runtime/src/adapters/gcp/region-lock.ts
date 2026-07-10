// GCP regions: `us-east1` (single-block, no hyphen before digit) AND
// `me-central-2` / `us-west1-a` (with hyphen before digit/letter suffix).
const REGION_RE = /^[a-z]+-[a-z]+-?\d+(?:-\d+|[a-z])?$/;

export function isRegionGcpResource(s: string): boolean {
  return REGION_RE.test(s);
}

export function assertRegion(expected: string, resource: string, lockEnabled: boolean): void {
  if (!lockEnabled) return;
  const tokens = resource.split(/[\/\s,]+/);
  for (const t of tokens) {
    if (isRegionGcpResource(t) && t !== expected) {
      throw new Error(
        `region lock violation: resource '${resource}' references region '${t}', expected '${expected}'. ` +
        `Set observability.region_lock=false to disable.`
      );
    }
  }
}
