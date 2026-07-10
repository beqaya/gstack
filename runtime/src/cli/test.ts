import type { AdapterHealth } from "../types";

export function formatHealthReport(h: AdapterHealth): string {
  const mark = h.ok ? "✓" : "✗";
  const lines = [
    `${mark} ${h.provider}: ${h.ok ? "healthy" : "unhealthy"}`,
    `   auth: ${h.auth_present ? "present" : "missing"}`,
    `   region: ${h.region ?? "n/a"}`,
    `   last check: ${h.last_check}`,
  ];
  if (h.message) lines.push(`   message: ${h.message}`);
  return lines.join("\n");
}

export async function runHealthCheck(
  provider: string,
  makeAdapter: () => Promise<{ healthCheck: () => Promise<AdapterHealth> }>,
): Promise<AdapterHealth> {
  if (provider !== "gcp") {
    return {
      ok: false, provider, last_check: new Date().toISOString(), auth_present: false,
      message: `Phase 1 supports gcp only; got ${provider}`,
    };
  }
  const adapter = await makeAdapter();
  return adapter.healthCheck();
}
