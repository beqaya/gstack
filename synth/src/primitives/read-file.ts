import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import type { Primitive, PrimitiveOutput } from "../types";

export async function runReadFile(p: Extract<Primitive, { op: "read_file" }>): Promise<PrimitiveOutput> {
  const norm = normalize(p.path);
  if (!isAbsolute(norm) || norm.includes("..")) {
    throw new Error(`read_file: path must be absolute and not contain '..' (got: ${p.path})`);
  }
  const text = await readFile(norm, "utf8");
  return { kind: "text", value: text };
}
