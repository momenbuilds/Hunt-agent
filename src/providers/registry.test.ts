import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config/config.js';
import { runtimeFromConfig } from '../llm/factory.js';
import { OpenAICompatibleProvider } from './api/openai-compatible.js';
import { ProviderRegistry, createProviderRegistry } from './registry.js';
import { ModelRouter } from './router.js';
import {
  API_CAPABILITIES,
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  LOCAL_CLI_CAPABILITIES,
  type ModelInfo,
  type ProviderCapabilities,
  type ProviderKind,
  type ProviderStatus,
} from './types.js';

class FakeProvider implements AgentProvider {
  readonly kind: ProviderKind = 'api';
  readonly enabled = true;
  readonly name: string;
  readonly defaultModel: string;
  calls = 0;

  constructor(
    readonly id: string,
    private readonly opts: {
      healthy?: boolean;
      fail?: boolean;
      capabilities?: ProviderCapabilities;
      model?: string;
    } = {},
  ) {
    this.name = id;
    this.defaultModel = opts.model ?? 'm';
  }

  get capabilities(): ProviderCapabilities {
    return this.opts.capabilities ?? API_CAPABILITIES;
  }

  async isAvailable(): Promise<boolean> {
    return this.opts.healthy !== false;
  }

  async getStatus(): Promise<ProviderStatus> {
    const healthy = await this.isAvailable();
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      enabled: true,
      available: healthy,
      healthy,
      status: healthy ? 'ready' : 'unavailable',
      message: healthy ? 'ready' : 'down',
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.defaultModel, provider: this.id, capabilities: this.capabilities }];
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    this.calls += 1;
    if (this.opts.fail) throw new Error(`${this.id} failed`);
    return {
      content: `${this.id}:${request.model}`,
      model: request.model ?? this.defaultModel,
      provider: this.id,
      message: { role: 'assistant', content: `${this.id}:${request.model}` },
      finishReason: 'stop',
    };
  }
}

describe('ProviderRegistry', () => {
  it('registers providers and resolves provider:model references', () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('alpha'));

    expect(registry.get('alpha')?.name).toBe('alpha');
    expect(registry.resolveModelRef('alpha:big').model).toBe('big');
  });

  it('throws a clear missing-provider error', () => {
    const registry = new ProviderRegistry();

    expect(() => registry.resolveModelRef('missing:model')).toThrow(/unknown provider/);
  });

  it('reports missing API keys without storing raw keys', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'remote',
      name: 'Remote',
      baseUrl: 'https://example.invalid/v1',
      apiKeyEnv: 'HUNT_AGENT_TEST_MISSING_KEY',
    });

    const status = await provider.getStatus();
    expect(status.status).toBe('missing-api-key');
    expect(status.message).toContain('API key');
  });

  it('maps old backend/model config into provider runtime config', () => {
    const cfg = defaultConfig();
    cfg.backend = 'ollama';
    cfg.model = 'llama3:8b';

    const runtime = runtimeFromConfig(cfg);

    expect(runtime.providers.ollama?.type).toBe('local-llm');
    expect(runtime.models.default).toBe('ollama:llama3:8b');
  });

  it('creates configured built-ins from new provider config', () => {
    const cfg = defaultConfig();
    cfg.providers['codex-cli'] = {
      type: 'local-cli',
      enabled: true,
      name: undefined,
      baseUrl: '',
      apiKeyEnv: '',
      apiKey: '',
      model: '',
      models: [],
      command: 'codex',
      args: ['exec', '-'],
      inputMode: 'stdin',
      outputMode: 'stdout',
      shell: false,
      timeoutMs: undefined,
      maxOutputBytes: undefined,
      allowInteractive: false,
    };
    cfg.models.default = 'codex-cli';

    const registry = createProviderRegistry(runtimeFromConfig(cfg));
    expect(registry.get('codex-cli')?.name).toBe('Codex CLI');
  });
});

describe('ModelRouter', () => {
  it('routes by role and falls back when the first provider fails', async () => {
    const registry = new ProviderRegistry();
    const first = new FakeProvider('first', { fail: true });
    const second = new FakeProvider('second');
    registry.register(first);
    registry.register(second);
    const router = new ModelRouter({
      registry,
      models: { default: 'first:m1', planner: 'first:m2' },
      fallbacks: { planner: ['second:m3'] },
      configuredProviderIds: ['first', 'second'],
    });

    const response = await router.complete({
      role: 'planner',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(first.calls).toBe(1);
    expect(response.provider).toBe('second');
    expect(response.model).toBe('m3');
  });

  it('skips providers that cannot emit tool calls for tool turns', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      new FakeProvider('cli', {
        capabilities: { ...LOCAL_CLI_CAPABILITIES, toolCalling: false },
      }),
    );
    registry.register(new FakeProvider('api'));
    const router = new ModelRouter({
      registry,
      models: { default: 'cli', executor: 'cli' },
      fallbacks: { executor: ['api:agentic'] },
      configuredProviderIds: ['cli', 'api'],
    });

    const response = await router.complete({
      role: 'executor',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { type: 'function', function: { name: 'ping', description: 'ping', parameters: {} } },
      ],
    });

    expect(response.provider).toBe('api');
    expect(response.model).toBe('agentic');
  });

  it('returns a clear error when no provider is healthy', async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('down', { healthy: false }));
    const router = new ModelRouter({
      registry,
      models: { default: 'down:m' },
      configuredProviderIds: ['down'],
    });

    await expect(router.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /no healthy provider/,
    );
  });
});
