import { describe, expect, test } from "bun:test";
import { createMockKeychain } from "../src/auth/keychain";

describe("keychain abstraction (mock)", () => {
  test("set + get round-trips", async () => {
    const kc = createMockKeychain();
    await kc.setSecret("gstack-runtime", "gcp:token", "abc123");
    expect(await kc.getSecret("gstack-runtime", "gcp:token")).toBe("abc123");
  });

  test("get returns null for missing key", async () => {
    const kc = createMockKeychain();
    expect(await kc.getSecret("gstack-runtime", "nope")).toBeNull();
  });

  test("delete removes the key", async () => {
    const kc = createMockKeychain();
    await kc.setSecret("gstack-runtime", "gcp:token", "abc");
    await kc.deleteSecret("gstack-runtime", "gcp:token");
    expect(await kc.getSecret("gstack-runtime", "gcp:token")).toBeNull();
  });
});
