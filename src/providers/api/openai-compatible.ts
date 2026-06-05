import type { Backend } from '../../config/config.js';
import { listModels as listBackendModels } from '../../llm/models.js';
import { OpenAIClient } from '../../llm/openai.js';
import type { ChatRequest } from '../../llm/types.js';
import { redact } from '../../redact/index.js';
import {
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  type AgentStreamChunk,
  type ModelInfo,
  OPENAI_COMPATIBLE_CAPABILITIES,
  type ProviderCapabilities,
  type ProviderKind,
  type ProviderStatus,
} from '../types.js';

export interface OpenAICompatibleProviderOptions {
  id: string;
  name: string;
  kind?: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
  defaultModel?: string;
  staticModels?: string[];
  capabilities?: Partial<ProviderCapabilities>;
  listBackend?: Backend;
  setupHint?: string;
  local?: boolean;
}

export class OpenAICompatibleProvider implements AgentProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly defaultModel?: string;
  readonly capabilities: ProviderCapabilities;

  private readonly apiKeyValue: string;
  private readonly staticModels: string[];
  private readonly listBackend?: Backend;
  private readonly setupHintValue: string;

  constructor(opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.kind = opts.kind ?? 'openai-compatible';
    this.enabled = opts.enabled ?? true;
    this.baseUrl = opts.baseUrl;
    this.apiKeyEnv = opts.apiKeyEnv ?? '';
    this.apiKeyValue = opts.apiKey ?? '';
    this.defaultModel = opts.defaultModel;
    this.staticModels = opts.staticModels ?? [];
    this.listBackend = opts.listBackend;
    this.setupHintValue =
      opts.setupHint ??
      `Set ${this.apiKeyEnv || `${this.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`} and configure provider ${this.id}.`;
    this.capabilities = {
      ...OPENAI_COMPATIBLE_CAPABILITIES,
      ...opts.capabilities,
      local: opts.local ?? opts.capabilities?.local ?? false,
      requiresApiKey: Boolean(opts.apiKeyEnv || opts.apiKey),
    };
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).healthy;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.enabled) {
      return this.status('disabled', false, 'provider is disabled');
    }
    if (!this.baseUrl) {
      return this.status(
        'error',
        false,
        'baseUrl is required',
        'Set a baseUrl in providers config.',
      );
    }
    if (this.capabilities.requiresApiKey && !this.apiKey()) {
      return this.status('missing-api-key', false, `${this.name} API key is not configured`);
    }
    try {
      const client = this.client(this.defaultModel ?? 'health-check');
      await client.ping(newAbortSignal(5_000));
      return this.status('ready', true, 'ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.status('unavailable', false, redact.apply(message));
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const ids = await this.modelIds();
    return ids.map((id) => ({
      id,
      provider: this.id,
      capabilities: this.capabilities,
    }));
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
    yield* streamFromCallback((push) =>
      this.client(model)
        .chatStream(
          toChatRequest(request, model),
          (delta) => push({ content: delta }),
          request.abortSignal,
        )
        .then((resp) => ({
          content: resp.message.content,
          model,
          provider: this.id,
          message: resp.message,
          finishReason: resp.finishReason,
        })),
    );
  }

  protected apiKey(): string {
    if (this.apiKeyEnv) {
      const value = process.env[this.apiKeyEnv];
      if (value) return value;
    }
    return this.apiKeyValue;
  }

  protected client(model: string): OpenAIClient {
    return new OpenAIClient(this.baseUrl, this.apiKey(), model, this.id);
  }

  private async modelIds(): Promise<string[]> {
    if (!this.enabled) return [];
    if (this.listBackend) {
      try {
        return await listBackendModels(this.listBackend, this.baseUrl, this.apiKey());
      } catch {
        // Fall back to static recommendations. Status reports the live
        // health separately; model listing should still be useful offline.
      }
    }
    if (this.staticModels.length > 0) return this.staticModels;
    return this.defaultModel ? [this.defaultModel] : [];
  }

  private status(
    status: ProviderStatus['status'],
    healthy: boolean,
    message: string,
    setupHint = this.setupHintValue,
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

async function* streamFromCallback(
  run: (push: (chunk: AgentStreamChunk) => void) => Promise<AgentResponse>,
): AsyncIterable<AgentStreamChunk> {
  const queue: AgentStreamChunk[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let thrown: unknown;

  const push = (chunk: AgentStreamChunk) => {
    queue.push(chunk);
    wake?.();
    wake = undefined;
  };

  void run(push)
    .then((response) => push({ done: true, response }))
    .catch((err: unknown) => {
      thrown = err;
    })
    .finally(() => {
      done = true;
      wake?.();
      wake = undefined;
    });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      continue;
    }
    const chunk = queue.shift();
    if (chunk) yield chunk;
  }
  if (thrown) throw thrown;
}
