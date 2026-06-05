import type { Client, Pinger, StreamingClient } from '../llm/client.js';
import type { ChatRequest, ChatResponse } from '../llm/types.js';
import type { ProviderRegistry, ResolvedModel } from './registry.js';
import type {
  AgentProvider,
  AgentRequest,
  AgentResponse,
  AgentStreamChunk,
  ModelRole,
  ProviderStatus,
} from './types.js';

export interface ModelRouterOptions {
  registry: ProviderRegistry;
  models: Partial<Record<ModelRole, string>>;
  fallbacks?: Partial<Record<ModelRole, string[]>>;
  configuredProviderIds?: string[];
  noFallback?: boolean;
}

export interface RouteAttempt {
  ref: string;
  reason: string;
}

export interface RouteResult {
  resolved: ResolvedModel;
  attempts: RouteAttempt[];
}

export class ModelRouter {
  readonly registry: ProviderRegistry;
  readonly models: Partial<Record<ModelRole, string>>;
  readonly fallbacks: Partial<Record<ModelRole, string[]>>;
  readonly configuredProviderIds: string[];
  readonly noFallback: boolean;

  constructor(opts: ModelRouterOptions) {
    this.registry = opts.registry;
    this.models = opts.models;
    this.fallbacks = opts.fallbacks ?? {};
    this.configuredProviderIds = opts.configuredProviderIds ?? [];
    this.noFallback = opts.noFallback ?? false;
  }

  defaultRef(): string {
    return this.models.default ?? this.configuredProviderIds[0] ?? 'ollama';
  }

  async resolve(role: ModelRole = 'default', request?: AgentRequest): Promise<RouteResult> {
    const refs = this.candidateRefs(role);
    const attempts: RouteAttempt[] = [];
    const defaultProviderId = this.defaultProviderId();
    for (const ref of refs) {
      let resolved: ResolvedModel;
      try {
        resolved = this.registry.resolveModelRef(ref, defaultProviderId);
      } catch (err) {
        attempts.push({ ref, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const capability = capabilityMismatch(resolved.provider, request);
      if (capability) {
        attempts.push({ ref, reason: capability });
        continue;
      }
      const status = await resolved.provider.getStatus();
      if (!status.healthy) {
        attempts.push({ ref, reason: status.message });
        continue;
      }
      return { resolved, attempts };
    }
    throw new Error(formatRouteFailure(role, attempts));
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const role = request.role ?? 'default';
    const refs = this.candidateRefs(role);
    const attempts: RouteAttempt[] = [];
    const defaultProviderId = this.defaultProviderId();
    for (const ref of refs) {
      let resolved: ResolvedModel;
      try {
        resolved = this.registry.resolveModelRef(ref, defaultProviderId);
      } catch (err) {
        attempts.push({ ref, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const capability = capabilityMismatch(resolved.provider, request);
      if (capability) {
        attempts.push({ ref, reason: capability });
        continue;
      }
      const status = await resolved.provider.getStatus();
      if (!status.healthy) {
        attempts.push({ ref, reason: status.message });
        continue;
      }
      try {
        return await resolved.provider.complete({
          ...request,
          model: resolved.model,
          role,
          metadata: {
            ...request.metadata,
            resolvedProvider: resolved.providerId,
            resolvedModel: resolved.model,
          },
        });
      } catch (err) {
        attempts.push({ ref, reason: err instanceof Error ? err.message : String(err) });
        if (this.noFallback) break;
      }
    }
    throw new Error(formatRouteFailure(role, attempts));
  }

  async *stream(request: AgentRequest): AsyncIterable<AgentStreamChunk> {
    const role = request.role ?? 'default';
    const route = await this.resolve(role, request);
    const req = {
      ...request,
      role,
      model: route.resolved.model,
      metadata: {
        ...request.metadata,
        resolvedProvider: route.resolved.providerId,
        resolvedModel: route.resolved.model,
      },
    };
    if (route.resolved.provider.stream && route.resolved.provider.capabilities.streaming) {
      yield* route.resolved.provider.stream(req);
      return;
    }
    const response = await route.resolved.provider.complete(req);
    yield { content: response.content };
    yield { done: true, response };
  }

  async statuses(): Promise<ProviderStatus[]> {
    return this.registry.statuses();
  }

  private candidateRefs(role: ModelRole): string[] {
    const refs: string[] = [];
    const push = (ref: string | undefined) => {
      if (!ref || refs.includes(ref)) return;
      refs.push(ref);
    };
    push(this.models[role]);
    if (!this.noFallback) {
      for (const ref of this.fallbacks[role] ?? []) push(ref);
    }
    if (role !== 'default') push(this.models.default);
    if (!this.noFallback && role !== 'default') {
      for (const ref of this.fallbacks.default ?? []) push(ref);
    }
    if (!this.noFallback) {
      for (const id of this.configuredProviderIds) push(id);
    }
    if (refs.length === 0) push('ollama');
    return refs;
  }

  private defaultProviderId(): string | undefined {
    const ref = this.models.default;
    if (!ref) return this.configuredProviderIds[0];
    if (this.registry.has(ref)) return ref;
    const idx = ref.indexOf(':');
    if (idx > 0) {
      const id = ref.slice(0, idx);
      if (this.registry.has(id)) return id;
    }
    return this.configuredProviderIds[0];
  }
}

export class RoutedClient implements Client, StreamingClient, Pinger {
  private lastProvider = '';
  private lastModel = '';

  constructor(private readonly router: ModelRouter) {}

  name(): string {
    return this.lastProvider || providerPart(this.router.defaultRef()) || 'router';
  }

  model(): string {
    return this.lastModel || modelPart(this.router.defaultRef()) || this.router.defaultRef();
  }

  async ping(signal?: AbortSignal): Promise<void> {
    const resolved = await this.router.resolve('default', { messages: [], abortSignal: signal });
    this.lastProvider = resolved.resolved.providerId;
    this.lastModel = resolved.resolved.model;
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const response = await this.router.complete({
      role: req.role,
      messages: req.messages,
      tools: req.tools,
      abortSignal: signal,
    });
    this.lastProvider = response.provider;
    this.lastModel = response.model;
    return {
      message: response.message ?? { role: 'assistant', content: response.content },
      finishReason: response.finishReason ?? 'stop',
    };
  }

  async chatStream(
    req: ChatRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    let final: AgentResponse | undefined;
    for await (const chunk of this.router.stream({
      role: req.role,
      messages: req.messages,
      tools: req.tools,
      abortSignal: signal,
    })) {
      if (chunk.content) onDelta(chunk.content);
      if (chunk.response) final = chunk.response;
    }
    if (!final) {
      throw new Error('router: provider stream ended without a final response');
    }
    this.lastProvider = final.provider;
    this.lastModel = final.model;
    return {
      message: final.message ?? { role: 'assistant', content: final.content },
      finishReason: final.finishReason ?? 'stop',
    };
  }
}

function capabilityMismatch(provider: AgentProvider, request?: AgentRequest): string {
  if (!request) return '';
  if (request.tools?.length && !provider.capabilities.toolCalling) {
    return 'provider does not support Hunt-agent tool calls';
  }
  if (request.jsonMode && !provider.capabilities.jsonMode) {
    return 'provider does not support JSON mode';
  }
  return '';
}

function formatRouteFailure(role: ModelRole, attempts: RouteAttempt[]): string {
  if (attempts.length === 0) {
    return `no provider is configured for role "${role}"`;
  }
  return [
    `no healthy provider is available for role "${role}"`,
    ...attempts.map((a) => `- ${a.ref}: ${a.reason}`),
  ].join('\n');
}

function providerPart(ref: string): string {
  const idx = ref.indexOf(':');
  return idx > 0 ? ref.slice(0, idx) : ref;
}

function modelPart(ref: string): string {
  const idx = ref.indexOf(':');
  return idx > 0 ? ref.slice(idx + 1) : '';
}
