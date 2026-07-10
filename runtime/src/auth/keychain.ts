export interface Keychain {
  getSecret(service: string, account: string): Promise<string | null>;
  setSecret(service: string, account: string, value: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<void>;
}

export function createMockKeychain(): Keychain {
  const store = new Map<string, string>();
  const key = (s: string, a: string) => `${s}::${a}`;
  return {
    async getSecret(s, a) { return store.get(key(s, a)) ?? null; },
    async setSecret(s, a, v) { store.set(key(s, a), v); },
    async deleteSecret(s, a) { store.delete(key(s, a)); },
  };
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, value: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarWarned = false;

export function createRealKeychain(): Keychain {
  let keytar: KeytarLike | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    keytar = require("keytar") as KeytarLike;
  } catch {
    if (!keytarWarned) {
      console.warn("[runtime] keytar not available — secrets will live in process memory only. Install keytar or use env-var fallback.");
      keytarWarned = true;
    }
    return createMockKeychain();
  }
  return {
    async getSecret(service, account) { return await keytar!.getPassword(service, account); },
    async setSecret(service, account, value) { await keytar!.setPassword(service, account, value); },
    async deleteSecret(service, account) { await keytar!.deletePassword(service, account); },
  };
}
