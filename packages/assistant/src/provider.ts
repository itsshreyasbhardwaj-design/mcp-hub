import type { HubConfig } from '@mcp-hub/config';

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
}

export interface LlmCompletion {
  text: string;
  provider: string;
  model: string | null;
  /** True when no model was involved and the text was assembled from evidence. */
  deterministic: boolean;
}

/**
 * The model seam.
 *
 * MCP Hub never requires a model. Everything the assistant answers is derived
 * from a structured query against the organization's own data; a provider only
 * turns collected evidence into prose. `grounded` does that deterministically
 * with no network call, which is also what makes the assistant testable.
 */
export interface LlmProvider {
  readonly name: string;
  readonly requiresNetwork: boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}

export function selectProvider(config: HubConfig): LlmProvider {
  return config.llm.provider === 'openrouter'
    ? new OpenRouterProvider(config.llm.openRouterApiKey ?? '', config.llm.model, config.appUrl)
    : new GroundedProvider();
}

/**
 * Renders the evidence the pipeline collected, without a model.
 *
 * This is the default because a wrong explanation about why a production
 * server is failing is worse than a plain list of what was measured.
 */
export class GroundedProvider implements LlmProvider {
  readonly name = 'grounded';
  readonly requiresNetwork = false;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const user = request.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    return { text: user.trim(), provider: this.name, model: null, deterministic: true };
  }
}

/** Routes explanation through OpenRouter. Optional, and never required. */
export class OpenRouterProvider implements LlmProvider {
  readonly name = 'openrouter';
  readonly requiresNetwork = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly appUrl: string,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const response = await globalThis.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'http-referer': this.appUrl,
        'x-title': 'MCP Hub',
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter responded ${response.status}.`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    return { text, provider: this.name, model: this.model, deterministic: false };
  }
}
