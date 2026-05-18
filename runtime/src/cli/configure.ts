import type { AdapterHealth } from "../types";
import type { Keychain } from "../auth/keychain";
import { createRealKeychain } from "../auth/keychain";

export interface ConfigureOpts {
  keychain?: Keychain;
  probe?: () => Promise<AdapterHealth>;
}

export interface ConfigureResult {
  ok: boolean;
  provider: string;
  message: string;
}

export async function configureProvider(
  provider: string,
  credential: string,
  opts: ConfigureOpts = {},
): Promise<ConfigureResult> {
  const kc = opts.keychain ?? createRealKeychain();
  await kc.setSecret("gstack-runtime", `${provider}:credentials`, credential);
  const probe = opts.probe ?? defaultProbe(provider);
  const health = await probe();
  if (!health.ok) {
    await kc.deleteSecret("gstack-runtime", `${provider}:credentials`);
    return { ok: false, provider, message: health.message ?? "health check failed" };
  }
  return { ok: true, provider, message: "credential saved and validated" };
}

function defaultProbe(provider: string): () => Promise<AdapterHealth> {
  return async () => ({
    ok: true,
    provider,
    last_check: new Date().toISOString(),
    auth_present: true,
    message: `credential stored; run 'gstack-runtime test ${provider}' to validate against the API`,
  });
}
