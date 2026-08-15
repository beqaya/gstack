import type { Primitive, PrimitiveOutput } from "../types";

export interface OrchestrationCtx {
  resolveRef(ref: string): Promise<PrimitiveOutput>;
}

export async function runParallel(
  p: Extract<Primitive, { op: "parallel" }>,
  ctx: OrchestrationCtx,
): Promise<PrimitiveOutput> {
  const outputs = await Promise.all(p.steps.map(async s => [s.ref, await ctx.resolveRef(s.ref)] as const));
  const combined: Record<string, PrimitiveOutput> = {};
  for (const [ref, out] of outputs) combined[ref] = out;
  return { kind: "json", value: combined };
}
