import { describe, expect, test } from "bun:test";
import { callLlm } from "../src/engine/llm-caller";

interface MockCreateOpts { messages: { content: string }[] }

describe("LLM caller", () => {
  test("forwards prompt to underlying SDK", async () => {
    let capturedPrompt = "";
    const mockSdk = {
      messages: {
        async create(opts: MockCreateOpts) {
          capturedPrompt = opts.messages[0].content;
          return { content: [{ type: "text", text: '{"plan_id":"p_1","goal":"g","created_at":"x","nodes":[]}' }] };
        },
      },
    };
    const response = await callLlm("test prompt", { sdk: mockSdk, model: "claude-sonnet-4-6" });
    expect(capturedPrompt).toBe("test prompt");
    expect(response).toContain("plan_id");
  });

  test("retries once on transient failure", async () => {
    let attempts = 0;
    const mockSdk = {
      messages: {
        async create() {
          attempts++;
          if (attempts === 1) throw new Error("timeout");
          return { content: [{ type: "text", text: '{"ok":true}' }] };
        },
      },
    };
    const response = await callLlm("p", { sdk: mockSdk, model: "claude-sonnet-4-6" });
    expect(attempts).toBe(2);
    expect(response).toContain("ok");
  });

  test("gives up after second failure", async () => {
    const mockSdk = {
      messages: {
        async create() { throw new Error("perma fail"); },
      },
    };
    await expect(callLlm("p", { sdk: mockSdk, model: "claude-sonnet-4-6" })).rejects.toThrow(/perma fail/);
  });
});
