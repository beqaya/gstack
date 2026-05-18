import type { Primitive, PrimitiveOutput } from "../types";
import type { OrchestrationCtx } from "./parallel";

export async function runSequential(
  p: Extract<Primitive, { op: "sequential" }>,
  ctx: OrchestrationCtx,
): Promise<PrimitiveOutput> {
  const combined: Record<string, PrimitiveOutput> = {};
  for (const s of p.steps) {
    combined[s.ref] = await ctx.resolveRef(s.ref);
  }
  return { kind: "json", value: combined };
}
