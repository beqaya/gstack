import type { AggregateResult } from "../aggregate";

export interface RenderContext {
  region: string;
  projectName: string;
}

export function renderObserveSummary(agg: AggregateResult, ctx: RenderContext): string {
  const out: string[] = [];
  out.push(`PROD HEALTH — ${ctx.projectName} (${ctx.region})`.padEnd(50) + `Generated ${new Date().toISOString()}`);
  out.push("");

  const totalSignals = agg.errors.length + agg.logs.length + agg.incidents.length + agg.deployments.length;
  if (totalSignals === 0 && agg.latency_by_provider.length === 0) {
    out.push("no signals retrieved in this window.");
    if (agg.adapter_failures.length > 0) {
      out.push("");
      out.push("ADAPTER FAILURES:");
      for (const f of agg.adapter_failures) out.push(`  ${f.provider}.${f.method}: ${f.error}`);
    }
    return out.join("\n");
  }

  out.push(`Active incidents: ${agg.incidents.length}`);
  out.push(`Recent deploys:   ${agg.deployments.length}`);
  out.push("");

  if (agg.errors.length > 0) {
    out.push("TOP ERRORS");
    const top = agg.errors.slice(0, 5);
    top.forEach((e, i) => {
      const services = (e.metadata.services as string[] | undefined)?.join(", ") ?? "—";
      out.push(`${i + 1}. [${e.provider}/${e.count ?? "?"}]  ${e.message}`);
      out.push(`     First seen: ${e.timestamp}`);
      out.push(`     Services: ${services}`);
      out.push(`     → ${e.raw_link}`);
    });
    out.push("");
  }

  for (const dist of agg.latency_by_provider) {
    // A bucket with no requests has no endpoint identity either — rendering
    // it prints "? ? p95 0ms (0 req)", which reads like data. Skip empties.
    const real = dist.per_endpoint.filter((b) => b.count > 0 && b.endpoint);
    if (real.length === 0) continue;
    out.push(`LATENCY (${dist.provider} ${dist.region ?? ""})`);
    for (const b of real.slice(0, 10)) {
      out.push(`  ${b.endpoint.padEnd(40)} p95 ${b.p95_ms}ms  (${b.count} req)`);
    }
    out.push("");
  }

  if (agg.adapter_failures.length > 0) {
    out.push("ADAPTER FAILURES");
    for (const f of agg.adapter_failures) out.push(`  ${f.provider}.${f.method}: ${f.error}`);
    out.push("");
  }

  return out.join("\n");
}
