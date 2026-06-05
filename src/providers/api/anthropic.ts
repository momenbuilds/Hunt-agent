import { redact } from '../../redact/index.js';
import {
  API_CAPABILITIES,
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  type ModelInfo,
  type ProviderStatus,
} from '../types.js';

export interface AnthropicProviderOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
  defaultModel?: string;
  staticModels?: string[];
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicProvider implements AgentProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'api' as const;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly defaultModel?: string;
  readonly capabilities = {
    ...API_CAPABILITIES,
    streaming: false,
    toolCalling: false,
    jsonMode: false,
  };

  private readonly apiKeyValue: string;
  private readonly staticModels: string[];

  constructor(opts: AnthropicProviderOptions = {}) {
    this.id = opts.id ?? 'anthropic';
    this.name = opts.name ?? 'Anthropic API';
    this.enabled = opts.enabled ?? true;
    this.baseUrl = opts.baseUrl || 'https://api.anthropic.com/v1';
    this.apiKeyEnv = opts.apiKeyEnv ?? 'ANTHROPIC_API_KEY';
    this.apiKeyValue = opts.apiKey ?? '';
    this.defaultModel = opts.defaultModel ?? 'claude-sonnet-4-5';
    this.staticModels = opts.staticModels ?? ['claude-sonnet-4-5', 'claude-haiku-4-5'];
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).healthy;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.enabled) return this.status('disabled', false, 'provider is disabled');
    if (!this.apiKey())
      return this.status('missing-api-key', false, `${this.name} API key is not configured`);
    return this.status('ready', true, 'configured');
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.staticModels.map((id) => ({
      id,
      provider: this.id,
      capabilities: this.capabilities,
    }));
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    if (request.tools?.length) {
      throw new Error(
        `${this.id}: native tool-call mapping is not implemented in this provider yet`,
      );
    }
    const model = request.model || this.defaultModel;
    if (!model) throw new Error(`${this.id}: no model selected`);
    if (!this.apiKey()) throw new Error(`${this.id}: ${this.apiKeyEnv} is not configured`);
    const system =
      request.systemPrompt || request.messages.find((m) => m.role === 'system')?.content;
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
    const resp = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 2048,
        ...(system ? { system } : {}),
        messages,
      }),
      signal: request.abortSignal,
    });
    const raw = await resp.text();
    if (resp.status !== 200)
      throw new Error(`${this.id}: status ${resp.status}: ${redact.apply(raw)}`);
    const parsed = JSON.parse(raw) as AnthropicResponse;
    if (parsed.error?.message) throw new Error(`${this.id}: ${redact.apply(parsed.error.message)}`);
    const content = (parsed.content ?? [])
      .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
    return {
      content,
      model,
      provider: this.id,
      message: { role: 'assistant', content },
      finishReason: parsed.stop_reason ?? 'stop',
      usage: {
        inputTokens: parsed.usage?.input_tokens,
        outputTokens: parsed.usage?.output_tokens,
        totalTokens:
          parsed.usage?.input_tokens !== undefined && parsed.usage?.output_tokens !== undefined
            ? parsed.usage.input_tokens + parsed.usage.output_tokens
            : undefined,
      },
    };
  }

  private apiKey(): string {
    return process.env[this.apiKeyEnv] || this.apiKeyValue;
  }

  private status(
    status: ProviderStatus['status'],
    healthy: boolean,
    message: string,
  ): ProviderStatus {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      enabled: this.enabled,
      available: healthy,
      healthy,
      status,
      message,
      setupHint:
        'Set ANTHROPIC_API_KEY for hosted Anthropic API usage. Do not route Claude.ai Free, Pro, or Max subscription credentials through this app.',
    };
  }
}
