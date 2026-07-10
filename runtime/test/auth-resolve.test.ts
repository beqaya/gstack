import { describe, expect, test } from "bun:test";
import { resolveSecret } from "../src/auth/resolve";
import { createMockKeychain } from "../src/auth/keychain";

describe("auth resolver", () => {
  test("returns keychain value when present", async () => {
    const kc = createMockKeychain();
    await kc.setSecret("gstack-runtime", "gcp:credentials", "from-keychain");
    const val = await resolveSecret(kc, "gcp", "credentials", {});
    expect(val).toBe("from-keychain");
  });

  test("falls back to env when keychain empty", async () => {
    const kc = createMockKeychain();
    const val = await resolveSecret(kc, "gcp", "credentials", { GSTACK_RUNTIME_GCP_CREDENTIALS: "from-env" });
    expect(val).toBe("from-env");
  });

  test("returns null when both missing", async () => {
    const kc = createMockKeychain();
    expect(await resolveSecret(kc, "gcp", "credentials", {})).toBeNull();
  });

  test("env var name matches expected format", async () => {
    const kc = createMockKeychain();
    const env = { GSTACK_RUNTIME_SENTRY_TOKEN: "s-token" };
    expect(await resolveSecret(kc, "sentry", "token", env)).toBe("s-token");
  });
});
