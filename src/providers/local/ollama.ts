import { listModels as listBackendModels } from '../../llm/models.js';
import { OllamaClient } from '../../llm/ollama.js';
import type { ChatRequest } from '../../llm/types.js';
import { redact } from '../../redact/index.js';
import {
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  type AgentStreamChunk,
  LOCAL_LLM_CAPABILITIES,
  type ModelInfo,
  type ProviderStatus,
} from '../types.js';

export interface OllamaProviderOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  enabled?: boolean;
  defaultModel?: string;
  staticModels?: string[];
}

export class OllamaProvider implements AgentProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'local-llm' as const;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly defaultModel?: string;
  readonly capabilities = LOCAL_LLM_CAPABILITIES;

  private readonly staticModels: string[];

  constructor(opts: OllamaProviderOptions = {}) {
    this.id = opts.id ?? 'ollama';
    this.name = opts.name ?? 'Ollama';
    this.enabled = opts.enabled ?? true;
    this.baseUrl = opts.baseUrl || 'http://localhost:11434';
    this.defaultModel = opts.defaultModel;
    this.staticModels = opts.staticModels ?? [];
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).healthy;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.enabled) return this.status('disabled', false, 'provider is disabled');
    try {
      await new OllamaClient(this.baseUrl, this.defaultModel ?? 'health-check').ping(
        newAbortSignal(5_000),
      );
      return this.status('ready', true, 'ready');
    } catch (err) {
      return this.status(
        'unavailable',
        false,
        redact.apply(err instanceof Error ? err.message : String(err)),
        'Start Ollama locally, then run `ollama pull <model>`.',
      );
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    let ids = this.staticModels;
    try {
      ids = await listBackendModels('ollama', this.baseUrl);
    } catch {
      // Static/default model is enough for offline config inspection.
    }
    if (ids.length === 0 && this.defaultModel) ids = [this.defaultModel];
    return ids.map((id) => ({ id, provider: this.id, capabilities: this.capabilities }));
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const model = request.model || this.defaultModel;
    if (!model) throw new Error(`${this.id}: no model selected`);
    const resp = await new OllamaClient(this.baseUrl, model).chat(
      toChatRequest(request, model),
      request.abortSignal,
    );
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
      new OllamaClient(this.baseUrl, model)
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

  private status(
    status: ProviderStatus['status'],
    healthy: boolean,
    message: string,
    setupHint = 'Install and start Ollama, then pull a tool-capable model.',
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
