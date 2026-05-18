import { describe, expect, test } from "bun:test";
import { createCache } from "../src/cache";

describe("TTL cache", () => {
  test("returns cached value within TTL", () => {
    const cache = createCache<string>(1000);
    cache.set("k", "v1");
    expect(cache.get("k")).toBe("v1");
  });

  test("expires after TTL", async () => {
    const cache = createCache<string>(50);
    cache.set("k", "v1");
    await new Promise(r => setTimeout(r, 100));
    expect(cache.get("k")).toBeNull();
  });

  test("getOrFetch invokes loader on miss only", async () => {
    let calls = 0;
    const cache = createCache<string>(1000);
    const loader = async () => { calls++; return "loaded"; };
    expect(await cache.getOrFetch("k", loader)).toBe("loaded");
    expect(await cache.getOrFetch("k", loader)).toBe("loaded");
    expect(calls).toBe(1);
  });
});
