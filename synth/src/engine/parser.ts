import type { Plan } from "../types";

interface UnsafeParsed {
  plan_id?: unknown;
  goal?: unknown;
  created_at?: unknown;
  nodes?: unknown;
}

interface UnsafeNode {
  id?: unknown;
  primitive?: { op?: unknown };
  depends_on?: unknown;
}

export function parsePlanResponse(text: string): Plan {
  const json = extractJson(text);
  let parsed: UnsafeParsed;
  try {
    parsed = JSON.parse(json) as UnsafeParsed;
  } catch (err) {
    throw new Error(`plan response is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed.plan_id !== "string") throw new Error("plan: missing plan_id");
  if (typeof parsed.goal !== "string") throw new Error("plan: missing goal");
  if (typeof parsed.created_at !== "string") throw new Error("plan: missing created_at");
  if (!Array.isArray(parsed.nodes)) throw new Error("plan: nodes must be an array");

  for (const n of parsed.nodes as UnsafeNode[]) {
    if (typeof n.id !== "string") throw new Error("plan: node missing id");
    if (!n.primitive || typeof n.primitive !== "object") throw new Error(`plan: node ${n.id} missing primitive`);
    if (typeof n.primitive.op !== "string") throw new Error(`plan: node ${n.id} primitive missing op`);
    if (!Array.isArray(n.depends_on)) throw new Error(`plan: node ${n.id} depends_on must be array`);
  }

  return parsed as unknown as Plan;
}

function extractJson(text: string): string {
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/;
  const m = fence.exec(text);
  if (m) return m[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return text.trim();
  return text.slice(start, end + 1);
}
