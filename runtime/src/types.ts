export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type SignalType = "error" | "latency" | "log" | "incident" | "deployment";

export interface RuntimeSignal {
  type: SignalType;
  provider: string;
  timestamp: string;
  severity: Severity;
  message: string;
  region?: string;
  trace_id?: string;
  count?: number;
  raw_link: string;
  metadata: Record<string, unknown>;
}

export interface TimeWindow {
  start: string;
  end: string;
}

export interface FilterOpts {
  services?: string[];
  severity_min?: Severity;
  limit?: number;
}

export interface LatencyBucket {
  endpoint: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  count: number;
}

export interface LatencyDist {
  provider: string;
  region?: string;
  window: TimeWindow;
  per_endpoint: LatencyBucket[];
}

export interface AdapterHealth {
  ok: boolean;
  provider: string;
  last_check: string;
  message?: string;
  auth_present: boolean;
  region?: string;
}

export interface ProviderSpecificConfig {
  services?: string[];
  log_filter?: string;
  org?: string;
  project?: string;
  app?: string;
  project_ref?: string;
  [k: string]: unknown;
}

export interface ObservabilityConfig {
  primary: string;
  project_id: string;
  region: string;
  region_lock: boolean;
  secondary: string[];
  providers: Record<string, ProviderSpecificConfig>;
  redact_patterns: string[];
}
