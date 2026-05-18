export type Primitive =
  | { op: "read_file"; path: string }
  | { op: "grep"; pattern: string; path?: string; glob?: string }
  | { op: "git_log"; range?: string; format?: string }
  | { op: "git_diff"; range?: string }
  | { op: "health_score"; surface: "code" | "prod" | "both" }
  | { op: "prod_query"; provider: string; query: { kind: "errors" | "latency" | "logs"; window?: string } }
  | { op: "parallel"; steps: PlanNodeRef[] }
  | { op: "sequential"; steps: PlanNodeRef[] };

export interface PlanNodeRef {
  ref: string;
}

export interface PlanNode {
  id: string;
  primitive: Primitive;
  depends_on: string[];
  label?: string;
}

export interface Plan {
  plan_id: string;
  goal: string;
  created_at: string;
  nodes: PlanNode[];
  estimated_cost_usd?: number;
}

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type PrimitiveOutput =
  | { kind: "text"; value: string }
  | { kind: "json"; value: unknown }
  | { kind: "lines"; value: string[] }
  | { kind: "score"; value: number; details?: Record<string, unknown> }
  | { kind: "none" };

export interface NodeResult {
  node_id: string;
  status: NodeStatus;
  started_at: string;
  ended_at: string;
  output?: PrimitiveOutput;
  error?: string;
}

export interface ExecutionResult {
  plan_id: string;
  started_at: string;
  ended_at: string;
  status: "completed" | "failed" | "partial";
  outputs: Record<string, PrimitiveOutput>;
  node_results: NodeResult[];
}
