import { describe, expect, test } from "bun:test";
import { configureProvider } from "../src/cli/configure";
import { createMockKeychain } from "../src/auth/keychain";

describe("configure provider", () => {
  test("writes credential to keychain and validates via healthCheck", async () => {
    const kc = createMockKeychain();
    const result = await configureProvider("gcp", "test-token", {
      keychain: kc,
      probe: async () => ({ ok: true, provider: "gcp", last_check: "x", auth_present: true }),
    });
    expect(result.ok).toBe(true);
    expect(await kc.getSecret("gstack-runtime", "gcp:credentials")).toBe("test-token");
  });

  test("does NOT persist credential when health probe fails", async () => {
    const kc = createMockKeychain();
    const result = await configureProvider("gcp", "bad-token", {
      keychain: kc,
      probe: async () => ({ ok: false, provider: "gcp", last_check: "x", auth_present: true, message: "401" }),
    });
    expect(result.ok).toBe(false);
    expect(await kc.getSecret("gstack-runtime", "gcp:credentials")).toBeNull();
  });

  test("does NOT persist credential when health probe throws", async () => {
    const kc = createMockKeychain();
    const result = await configureProvider("gcp", "bad-token", {
      keychain: kc,
      probe: async () => { throw new Error("network unreachable"); },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("network unreachable");
    expect(await kc.getSecret("gstack-runtime", "gcp:credentials")).toBeNull();
  });
});
