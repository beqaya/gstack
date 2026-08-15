const ONE_HOUR_MS = 60 * 60 * 1000;

export interface LimiterConfig {
  maxConcurrent: number;
  maxActionsPerHour: number;
}

export interface Limiter {
  tryAcquire(repo: string): boolean;
  release(repo: string): void;
  state(): { active: number; recent: Record<string, number> };
}

export function createLimiter(cfg: LimiterConfig): Limiter {
  let active = 0;
  const recentByRepo = new Map<string, number[]>();

  function pruneOld(repo: string, now: number) {
    const arr = recentByRepo.get(repo) ?? [];
    const fresh = arr.filter(t => now - t < ONE_HOUR_MS);
    recentByRepo.set(repo, fresh);
    return fresh;
  }

  return {
    tryAcquire(repo: string): boolean {
      if (active >= cfg.maxConcurrent) return false;
      const now = Date.now();
      const fresh = pruneOld(repo, now);
      if (fresh.length >= cfg.maxActionsPerHour) return false;
      fresh.push(now);
      recentByRepo.set(repo, fresh);
      active += 1;
      return true;
    },
    release(_repo: string) {
      active = Math.max(0, active - 1);
    },
    state() {
      const recent: Record<string, number> = {};
      for (const [k, v] of recentByRepo) recent[k] = v.length;
      return { active, recent };
    },
  };
}
