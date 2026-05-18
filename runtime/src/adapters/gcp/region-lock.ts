const REGION_RE = /^[a-z]+-[a-z]+\d+(?:-\d+)?$/;

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
