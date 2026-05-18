import { homedir } from "node:os";
import { join } from "node:path";

export function runtimeRoot(): string {
  return join(homedir(), ".gstack", "runtime");
}

export function runtimeCacheDir(): string {
  return join(runtimeRoot(), "cache");
}

export function runtimeSecretsFallbackDir(): string {
  return join(runtimeRoot(), "secrets-fallback");
}
