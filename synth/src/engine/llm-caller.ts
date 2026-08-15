interface CreateOpts {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
}

interface LlmSdk {
  messages: {
    create(opts: CreateOpts): Promise<{ content: { type: string; text: string }[] }>;
  };
}

export interface LlmCallerOpts {
  sdk?: LlmSdk;
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export async function callLlm(prompt: string, opts: LlmCallerOpts): Promise<string> {
  const sdk = opts.sdk ?? buildRealSdk(opts.apiKey);
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sdk.messages.create({
        model: opts.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: opts.maxTokens ?? 4096,
      });
      const text = response.content.find(b => b.type === "text")?.text ?? "";
      return text;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("LLM call failed");
}

function buildRealSdk(apiKey?: string): LlmSdk {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { default: Anthropic } = require("@anthropic-ai/sdk") as { default: new (o: { apiKey: string }) => LlmSdk };
  return new Anthropic({ apiKey: key });
}
