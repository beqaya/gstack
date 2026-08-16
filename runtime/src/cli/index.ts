import { configureProvider } from "./configure";
import { runHealthCheck, formatHealthReport } from "./test";
import { parseWindowArg, parseProvidersArg } from "./fetch";
import { renderObserveSummary } from "../skills/observe";
import { loadObservabilityConfig } from "../config";
import { createRealKeychain } from "../auth/keychain";
import { resolveSecret } from "../auth/resolve";
import { getAdcToken } from "../auth/adc";
import { createGcpAdapter } from "../adapters/gcp";
import { createRedactEngine } from "../redact/engine";
import { aggregateSignals } from "../aggregate";
import type { TimeWindow } from "../types";

export interface ParsedArgs {
  command: "configure" | "test" | "fetch";
  provider?: string;
  credential?: string;
  providers: string[];
  window?: TimeWindow;
  repo?: string;
}

const COMMANDS = ["configure", "test", "fetch"] as const;

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (!cmd || !(COMMANDS as readonly string[]).includes(cmd)) {
    throw new Error(`unknown command: ${cmd ?? "(none)"}; expected one of ${COMMANDS.join(", ")}`);
  }
  const args: ParsedArgs = { command: cmd as ParsedArgs["command"], providers: [] };
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--providers") { args.providers = parseProvidersArg(rest[++i]); }
    else if (tok === "--window") { args.window = parseWindowArg(rest[++i]); }
    else if (tok === "--repo") { args.repo = rest[++i]; }
    else if (tok.startsWith("--")) { throw new Error(`unknown flag: ${tok}`); }
    else if (args.command === "configure" && !args.provider) args.provider = tok;
    else if (args.command === "configure" && !args.credential) args.credential = tok;
    else if (args.command === "test" && !args.provider) args.provider = tok;
  }
  return args;
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "configure": {
      if (!args.provider || !args.credential) throw new Error("usage: configure <provider> <credential>");
      const r = await configureProvider(args.provider, args.credential);
      console.log(r.ok ? `✓ ${r.provider}: ${r.message}` : `✗ ${r.provider}: ${r.message}`);
      process.exit(r.ok ? 0 : 1);
      return;
    }
    case "test": {
      if (!args.provider) throw new Error("usage: test <provider>");
      const repo = args.repo ?? process.cwd();
      const cfg = await loadObservabilityConfig(repo);
      if (!cfg) { console.error("no observability config found in", repo); process.exit(1); return; }
      const kc = createRealKeychain();
      let token = await resolveSecret(kc, args.provider, "credentials");
      // GCP: fall back to a live ADC token — stored tokens expire hourly.
      if (!token && args.provider === "gcp") token = await getAdcToken();
      const adapter = createGcpAdapter({
        projectId: cfg.project_id, region: cfg.region,
        regionLock: cfg.region_lock, authToken: token,
      });
      const h = await runHealthCheck(args.provider, async () => adapter);
      console.log(formatHealthReport(h));
      process.exit(h.ok ? 0 : 1);
      return;
    }
    case "fetch": {
      const repo = args.repo ?? process.cwd();
      const cfg = await loadObservabilityConfig(repo);
      if (!cfg) { console.error("no observability config found in", repo); process.exit(1); return; }
      const window: TimeWindow = args.window ?? parseWindowArg("24h");
      const kc = createRealKeychain();
      let token = await resolveSecret(kc, "gcp", "credentials");
      if (!token) token = await getAdcToken();
      const gcp = createGcpAdapter({
        projectId: cfg.project_id, region: cfg.region,
        regionLock: cfg.region_lock, authToken: token,
        logFilter: cfg.providers.gcp?.log_filter as string | undefined,
      });
      const result = await aggregateSignals([gcp], window);
      const redact = await createRedactEngine(cfg.redact_patterns);
      result.errors = redact.redactArray(result.errors);
      result.logs = redact.redactArray(result.logs);
      result.incidents = redact.redactArray(result.incidents);
      result.deployments = redact.redactArray(result.deployments);
      // Endpoint strings (e.g. "GET /tenants/1234567890") can leak PII from request paths.
      result.latency_by_provider = result.latency_by_provider.map(d => ({
        ...d,
        per_endpoint: d.per_endpoint.map(b => ({ ...b, endpoint: redact.redactString(b.endpoint) })),
      }));
      // SDK error messages can leak URL fragments containing PII / partial tokens.
      result.adapter_failures = result.adapter_failures.map(f => ({
        ...f,
        error: redact.redactString(f.error),
      }));
      const summary = renderObserveSummary(result, {
        region: cfg.region, projectName: cfg.project_id,
      });
      console.log(summary);
      return;
    }
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(err => {
    console.error("[gstack-runtime]", err.message);
    process.exit(1);
  });
}
