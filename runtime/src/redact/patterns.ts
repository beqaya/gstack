import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "js-yaml";

export interface RedactPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, "builtin");

interface RawPattern {
  name: string;
  pattern: string;
  flags?: string;
  replacement: string;
}

export async function loadPattern(name: string, dir = BUILTIN_DIR): Promise<RedactPattern> {
  const path = join(dir, `${name}.yaml`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`redact pattern '${name}' not found at ${path}`);
  }
  const parsed = load(raw) as RawPattern;
  if (parsed.name !== name) {
    throw new Error(`pattern file ${path} declares name '${parsed.name}' but expected '${name}'`);
  }
  return {
    name: parsed.name,
    regex: new RegExp(parsed.pattern, parsed.flags ?? "g"),
    replacement: parsed.replacement,
  };
}

export async function loadBuiltinPatterns(): Promise<RedactPattern[]> {
  const files = await readdir(BUILTIN_DIR);
  const yamls = files.filter(f => f.endsWith(".yaml"));
  return Promise.all(yamls.map(f => loadPattern(f.replace(/\.yaml$/, ""))));
}
