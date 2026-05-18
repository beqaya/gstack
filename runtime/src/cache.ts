interface Entry<T> { value: T; expires_at: number; }

export interface Cache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  getOrFetch(key: string, loader: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createCache<T>(ttlMs: number): Cache<T> {
  const store = new Map<string, Entry<T>>();
  const cache: Cache<T> = {
    get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (Date.now() > e.expires_at) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    set(key, value) {
      store.set(key, { value, expires_at: Date.now() + ttlMs });
    },
    async getOrFetch(key, loader) {
      const hit = cache.get(key);
      if (hit !== null) return hit;
      const value = await loader();
      cache.set(key, value);
      return value;
    },
    clear() { store.clear(); },
  };
  return cache;
}
