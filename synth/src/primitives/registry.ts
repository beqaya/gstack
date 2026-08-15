import type { Primitive } from "../types";

export interface PrimitiveMeta {
  op: Primitive["op"];
  mutating: boolean;
  inputs: string[];
  outputs: string[];
  est_latency_ms: number;
  description: string;
}

const REGISTRY: Record<string, PrimitiveMeta> = {
  read_file: {
    op: "read_file", mutating: false,
    inputs: ["path"], outputs: ["text"],
    est_latency_ms: 10,
    description: "Read a file's full contents.",
  },
  grep: {
    op: "grep", mutating: false,
    inputs: ["pattern", "path?", "glob?"], outputs: ["lines"],
    est_latency_ms: 500,
    description: "Search file contents for a regex pattern; returns matching lines.",
  },
  git_log: {
    op: "git_log", mutating: false,
    inputs: ["range?", "format?"], outputs: ["text"],
    est_latency_ms: 200,
    description: "Run git log with optional range and format.",
  },
  git_diff: {
    op: "git_diff", mutating: false,
    inputs: ["range?"], outputs: ["text"],
    est_latency_ms: 500,
    description: "Run git diff with optional range.",
  },
  prod_query: {
    op: "prod_query", mutating: false,
    inputs: ["provider", "query"], outputs: ["json"],
    est_latency_ms: 5000,
    description: "Query a runtime provider for errors|latency|logs. Requires gstack-runtime.",
  },
  parallel: {
    op: "parallel", mutating: false,
    inputs: ["steps"], outputs: ["json"],
    est_latency_ms: 0,
    description: "Execute multiple steps in parallel.",
  },
  sequential: {
    op: "sequential", mutating: false,
    inputs: ["steps"], outputs: ["json"],
    est_latency_ms: 0,
    description: "Execute steps in order.",
  },
};

export function primitiveMetadata(op: string): PrimitiveMeta {
  const m = REGISTRY[op];
  if (!m) throw new Error(`primitive '${op}' is not registered (Phase 1.1-1.3 supports read-only only)`);
  return m;
}

export function allPrimitives(): string[] {
  return Object.keys(REGISTRY);
}

export function isReadOnly(op: string): boolean {
  return REGISTRY[op]?.mutating === false;
}

export function registryAsPromptText(): string {
  return Object.values(REGISTRY).map(m => {
    return `- ${m.op}(${m.inputs.join(", ")}) → ${m.outputs.join("|")}: ${m.description} [~${m.est_latency_ms}ms]`;
  }).join("\n");
}
