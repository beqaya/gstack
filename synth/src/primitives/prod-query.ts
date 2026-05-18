import type { Primitive, PrimitiveOutput } from "../types";

// Soft dependency on Plan 2's runtime module. Dynamic import gated behind detection
// so synth tests pass with or without gstack-runtime installed in the gstack repo.
const RUNTIME_AGGREGATE_PATH = "../../../runtime/src/aggregate.ts";
const RUNTIME_GCP_PATH = "../../../runtime/src/adapters/gcp/index.ts";
const RUNTIME_CONFIG_PATH = "../../../runtime/src/config.ts";

export async function isProdQueryAvailable(): Promise<boolean> {
  try {
    await import(/* @vite-ignore */ RUNTIME_AGGREGATE_PATH);
    return true;
  } catch {
    return false;
  }
}

interface RuntimeBindings {
  aggregateSignals: (adapters: unknown[], window: { start: string; end: string }) => Promise<unknown>;
  createGcpAdapter: (opts: unknown) => unknown;
  loadObservabilityConfig: (cwd: string) => Promise<{ project_id: string; region: string; region_lock: boolean } | null>;
}

export async function runProdQuery(
  p: Extract<Primitive, { op: "prod_query" }>,
  ctx: { cwd: string; forceStub?: boolean; bindings?: RuntimeBindings },
): Promise<PrimitiveOutput> {
  if (ctx.forceStub) {
    throw new Error(
      "prod_query: requires gstack-runtime (Spec 2). Install Spec 2 Phase 1 (/observe + adapters) to enable this primitive. " +
      "Until then, synth plans cannot use prod_query."
    );
  }

  let bindings = ctx.bindings;
  if (!bindings) {
    try {
      const [agg, gcp, cfg] = await Promise.all([
        import(/* @vite-ignore */ RUNTIME_AGGREGATE_PATH),
        import(/* @vite-ignore */ RUNTIME_GCP_PATH),
        import(/* @vite-ignore */ RUNTIME_CONFIG_PATH),
      ]);
      bindings = {
        aggregateSignals: agg.aggregateSignals,
        createGcpAdapter: gcp.createGcpAdapter,
        loadObservabilityConfig: cfg.loadObservabilityConfig,
      };
    } catch {
      throw new Error(
        "prod_query: requires gstack-runtime (Spec 2). Install Spec 2 Phase 1 (/observe + adapters) to enable this primitive."
      );
    }
  }

  const config = await bindings.loadObservabilityConfig(ctx.cwd);
  if (!config) throw new Error(`prod_query: observability config missing in ${ctx.cwd}`);

  if (p.provider !== "gcp") {
    throw new Error(`prod_query: provider '${p.provider}' not supported in Phase 1.1-1.3 (gcp only)`);
  }

  const adapter = bindings.createGcpAdapter({
    projectId: config.project_id, region: config.region,
    regionLock: config.region_lock,
    authToken: process.env.GSTACK_RUNTIME_GCP_CREDENTIALS ?? null,
  });
  const hours = parseInt((p.query.window ?? "24h").replace(/h$/, ""), 10);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  const window = { start: start.toISOString(), end: end.toISOString() };
  const result = await bindings.aggregateSignals([adapter], window);
  return { kind: "json", value: result };
}
