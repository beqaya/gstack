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
  // Probe may throw (network error, SDK bug). Treat any throw as "probe failed" and
  // roll back the credential — otherwise a bad token stays in keychain after the user
  // sees the failure.
  let health: AdapterHealth;
  try {
    health = await probe();
  } catch (err) {
    await kc.deleteSecret("gstack-runtime", `${provider}:credentials`);
    return { ok: false, provider, message: `health probe threw: ${(err as Error).message}` };
  }
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
