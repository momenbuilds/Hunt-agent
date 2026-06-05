import { GeminiClient } from '../../llm/gemini.js';
import { listModels as listBackendModels } from '../../llm/models.js';
import { GEMINI_DEFAULT_BASE_URL, GEMINI_RECOMMENDED_MODELS } from '../../llm/providers.js';
import type { ChatRequest } from '../../llm/types.js';
import { redact } from '../../redact/index.js';
import {
  API_CAPABILITIES,
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  type AgentStreamChunk,
  type ModelInfo,
  type ProviderStatus,
} from '../types.js';

export interface GeminiProviderOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
  defaultModel?: string;
  staticModels?: string[];
}

export class GeminiProvider implements AgentProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'api' as const;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly defaultModel?: string;
  readonly capabilities = {
    ...API_CAPABILITIES,
    vision: true,
    toolCalling: true,
  };

  private readonly apiKeyValue: string;
  private readonly staticModels: string[];

  constructor(opts: GeminiProviderOptions = {}) {
    this.id = opts.id ?? 'gemini';
    this.name = opts.name ?? 'Gemini';
    this.enabled = opts.enabled ?? true;
    this.baseUrl = opts.baseUrl || GEMINI_DEFAULT_BASE_URL;
    this.apiKeyEnv = opts.apiKeyEnv ?? 'GEMINI_API_KEY';
    this.apiKeyValue = opts.apiKey ?? '';
    this.defaultModel = opts.defaultModel;
    this.staticModels = opts.staticModels ?? GEMINI_RECOMMENDED_MODELS;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).healthy;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.enabled) return this.status('disabled', false, 'provider is disabled');
    if (!this.apiKey()) {
      return this.status('missing-api-key', false, `${this.name} API key is not configured`);
    }
    try {
      await this.client(this.defaultModel ?? 'models/gemini-3.5-flash').ping(newAbortSignal(5_000));
      return this.status('ready', true, 'ready');
    } catch (err) {
      return this.status(
        'unavailable',
        false,
        redact.apply(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    let ids = this.staticModels;
    try {
      ids = await listBackendModels('gemini', this.baseUrl, this.apiKey());
    } catch {
      // Use static recommendations offline.
    }
    return ids.map((id) => ({ id, provider: this.id, capabilities: this.capabilities }));
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const model = request.model || this.defaultModel;
    if (!model) throw new Error(`${this.id}: no model selected`);
    const resp = await this.client(model).chat(toChatRequest(request, model), request.abortSignal);
    return {
      content: resp.message.content,
      model,
      provider: this.id,
      message: resp.message,
      finishReason: resp.finishReason,
    };
  }

  async *stream(request: AgentRequest): AsyncIterable<AgentStreamChunk> {
    const model = request.model || this.defaultModel;
    if (!model) throw new Error(`${this.id}: no model selected`);
    const resp = await this.client(model).chat(toChatRequest(request, model), request.abortSignal);
    yield {
      done: true,
      response: {
        content: resp.message.content,
        model,
        provider: this.id,
        message: resp.message,
        finishReason: resp.finishReason,
      },
    };
  }

  private apiKey(): string {
    return process.env[this.apiKeyEnv] || this.apiKeyValue;
  }

  private client(model: string): GeminiClient {
    return new GeminiClient(this.baseUrl, this.apiKey(), model);
  }

  private status(
    status: ProviderStatus['status'],
    healthy: boolean,
    message: string,
    setupHint = `Set ${this.apiKeyEnv} and route a model such as gemini:models/gemini-3.5-flash.`,
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
      setupHint,
    };
  }
}

function toChatRequest(request: AgentRequest, model: string): ChatRequest {
  return {
    model,
    messages: request.messages.map((m) => ({ ...m })),
    tools: request.tools,
    stream: false,
  };
}

function newAbortSignal(timeoutMs: number): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  timer.unref?.();
  return ctl.signal;
}
