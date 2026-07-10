import type { Keychain } from "./keychain";
import { readEnv } from "./env-fallback";

const SERVICE = "gstack-runtime";

export async function resolveSecret(
  kc: Keychain,
  provider: string,
  secretName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const fromKc = await kc.getSecret(SERVICE, `${provider}:${secretName}`);
  if (fromKc) return fromKc;
  return readEnv(provider, secretName, env);
}
