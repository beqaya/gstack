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
  const activeByRepo = new Map<string, number>();
  const recentByRepo = new Map<string, number[]>();

  function pruneOld(repo: string, now: number) {
    const arr = recentByRepo.get(repo) ?? [];
    const fresh = arr.filter(t => now - t < ONE_HOUR_MS);
    recentByRepo.set(repo, fresh);
    return fresh;
  }

  function totalActive(): number {
    let n = 0;
    for (const v of activeByRepo.values()) n += v;
    return n;
  }

  return {
    tryAcquire(repo: string): boolean {
      const repoActive = activeByRepo.get(repo) ?? 0;
      if (repoActive >= cfg.maxConcurrent) return false;
      const now = Date.now();
      const fresh = pruneOld(repo, now);
      if (fresh.length >= cfg.maxActionsPerHour) return false;
      fresh.push(now);
      recentByRepo.set(repo, fresh);
      activeByRepo.set(repo, repoActive + 1);
      return true;
    },
    release(repo: string) {
      const repoActive = activeByRepo.get(repo) ?? 0;
      activeByRepo.set(repo, Math.max(0, repoActive - 1));
    },
    state() {
      const recent: Record<string, number> = {};
      for (const [k, v] of recentByRepo) recent[k] = v.length;
      return { active: totalActive(), recent };
    },
  };
}
