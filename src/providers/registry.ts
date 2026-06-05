import {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  GEMINI_RECOMMENDED_MODELS,
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  GROQ_MODELS,
  KIMI_DEFAULT_BASE_URL,
  KIMI_DEFAULT_MODEL,
  KIMI_MODELS,
} from '../llm/providers.js';
import { AnthropicProvider } from './api/anthropic.js';
import { GeminiProvider } from './api/gemini.js';
import { OpenAICompatibleProvider } from './api/openai-compatible.js';
import { BaseCLIProvider } from './cli/base-cli-provider.js';
import { ClaudeCodeProvider } from './cli/claude-code.js';
import { CodexCLIProvider } from './cli/codex-cli.js';
import { CustomShellProvider } from './cli/custom-shell.js';
import { OllamaProvider } from './local/ollama.js';
import type {
  AgentProvider,
  LocalCLISettings,
  ModelInfo,
  ProviderConfig,
  ProviderRuntimeConfig,
  ProviderStatus,
} from './types.js';

export interface ResolvedModel {
  ref: string;
  providerId: string;
  model: string;
  provider: AgentProvider;
}

const DEFAULT_LOCAL_CLI: LocalCLISettings = {
  timeoutMs: 120_000,
  maxOutputBytes: 200_000,
  allowInteractive: false,
};

export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  list(): AgentProvider[] {
    return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async statuses(): Promise<ProviderStatus[]> {
    return Promise.all(
      this.list().map(async (provider) => {
        const status = await provider.getStatus();
        try {
          status.models = (await provider.listModels()).length;
        } catch {
          // Keep status fast/useful even when a provider cannot list models.
        }
        return status;
      }),
    );
  }

  async listModels(): Promise<ModelInfo[]> {
    const all = await Promise.all(this.list().map((provider) => provider.listModels()));
    return all.flat();
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  resolveModelRef(ref: string, defaultProviderId?: string): ResolvedModel {
    const trimmed = ref.trim();
    if (!trimmed) throw new Error('model reference is empty');

    const exact = this.providers.get(trimmed);
    if (exact) {
      return {
        ref: trimmed,
        providerId: exact.id,
        model: exact.defaultModel ?? '',
        provider: exact,
      };
    }

    const separator = trimmed.indexOf(':');
    if (separator > 0) {
      const providerId = trimmed.slice(0, separator);
      const provider = this.providers.get(providerId);
      if (provider) {
        const model = trimmed.slice(separator + 1);
        if (!model) throw new Error(`model reference "${trimmed}" is missing a model id`);
        return { ref: trimmed, providerId, model, provider };
      }
    }

    if (defaultProviderId) {
      const provider = this.providers.get(defaultProviderId);
      if (provider) {
        return { ref: trimmed, providerId: provider.id, model: trimmed, provider };
      }
    }

    throw new Error(
      `unknown provider in model reference "${trimmed}". Use provider:model or configure a default provider.`,
    );
  }
}

export function createProviderRegistry(runtime: ProviderRuntimeConfig): ProviderRegistry {
  const registry = new ProviderRegistry();
  const localCli = runtime.localCli ?? DEFAULT_LOCAL_CLI;
  for (const provider of builtInProviders(localCli)) registry.register(provider);
  for (const [id, cfg] of Object.entries(runtime.providers)) {
    registry.register(providerFromConfig(id, cfg, localCli));
  }
  return registry;
}

function builtInProviders(localCli: LocalCLISettings): AgentProvider[] {
  return [
    new OllamaProvider({ enabled: true }),
    new OpenAICompatibleProvider({
      id: 'lmstudio',
      name: 'LM Studio',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:1234/v1',
      enabled: true,
      local: true,
      setupHint: 'Start LM Studio local server and load a tool-capable model.',
    }),
    new OpenAICompatibleProvider({
      id: 'openai-compat',
      name: 'OpenAI-compatible',
      baseUrl: '',
      enabled: false,
      setupHint:
        'Configure providers.openai-compat.baseUrl and optionally apiKeyEnv for your compatible endpoint.',
    }),
    new OpenAICompatibleProvider({
      id: 'openai',
      name: 'OpenAI API',
      kind: 'api',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      enabled: false,
      defaultModel: 'gpt-4.1-mini',
      staticModels: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    }),
    new AnthropicProvider({ enabled: false }),
    new OpenAICompatibleProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      enabled: false,
      defaultModel: 'deepseek/deepseek-r1',
      staticModels: ['deepseek/deepseek-r1', 'anthropic/claude-sonnet', 'openai/gpt-4.1-mini'],
    }),
    new OpenAICompatibleProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: GROQ_DEFAULT_BASE_URL,
      apiKeyEnv: 'GROQ_API_KEY',
      enabled: false,
      defaultModel: GROQ_DEFAULT_MODEL,
      staticModels: GROQ_MODELS,
      listBackend: 'groq',
    }),
    new GeminiProvider({
      baseUrl: GEMINI_DEFAULT_BASE_URL,
      enabled: false,
      defaultModel: GEMINI_DEFAULT_MODEL,
      staticModels: GEMINI_RECOMMENDED_MODELS,
    }),
    new OpenAICompatibleProvider({
      id: 'kimi',
      name: 'Kimi',
      baseUrl: KIMI_DEFAULT_BASE_URL,
      apiKeyEnv: 'MOONSHOT_API_KEY',
      enabled: false,
      defaultModel: KIMI_DEFAULT_MODEL,
      staticModels: KIMI_MODELS,
      listBackend: 'kimi',
    }),
    new OpenAICompatibleProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      enabled: false,
      defaultModel: 'deepseek-chat',
      staticModels: ['deepseek-chat', 'deepseek-reasoner'],
    }),
    new OpenAICompatibleProvider({
      id: 'xai',
      name: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      apiKeyEnv: 'XAI_API_KEY',
      enabled: false,
      defaultModel: 'grok-4',
      staticModels: ['grok-4', 'grok-4-mini'],
    }),
    new OpenAICompatibleProvider({
      id: 'mistral',
      name: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKeyEnv: 'MISTRAL_API_KEY',
      enabled: false,
      defaultModel: 'mistral-large-latest',
      staticModels: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    }),
    new OpenAICompatibleProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      apiKeyEnv: 'TOGETHER_API_KEY',
      enabled: false,
      defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      staticModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    }),
    new OpenAICompatibleProvider({
      id: 'fireworks',
      name: 'Fireworks AI',
      baseUrl: 'https://api.fireworks.ai/inference/v1',
      apiKeyEnv: 'FIREWORKS_API_KEY',
      enabled: false,
      defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      staticModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    }),
    new OpenAICompatibleProvider({
      id: 'cohere',
      name: 'Cohere',
      baseUrl: 'https://api.cohere.com/compatibility/v1',
      apiKeyEnv: 'COHERE_API_KEY',
      enabled: false,
      defaultModel: 'command-a-03-2025',
      staticModels: ['command-a-03-2025', 'command-r-plus'],
    }),
    new CodexCLIProvider({ enabled: false, localCli }),
    new ClaudeCodeProvider({ enabled: false, localCli }),
  ];
}

export function providerFromConfig(
  id: string,
  cfg: ProviderConfig,
  localCli: LocalCLISettings = DEFAULT_LOCAL_CLI,
): AgentProvider {
  const enabled = cfg.enabled ?? true;
  if (id === 'ollama' || cfg.type === 'local-llm') {
    return new OllamaProvider({
      id,
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      enabled,
      defaultModel: cfg.model,
      staticModels: cfg.models,
    });
  }
  if (id === 'gemini') {
    return new GeminiProvider({
      id,
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      apiKeyEnv: cfg.apiKeyEnv,
      enabled,
      defaultModel: cfg.model,
      staticModels: cfg.models,
    });
  }
  if (id === 'anthropic') {
    return new AnthropicProvider({
      id,
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      apiKeyEnv: cfg.apiKeyEnv,
      enabled,
      defaultModel: cfg.model,
      staticModels: cfg.models,
    });
  }
  if (cfg.type === 'local-cli') {
    if (id === 'codex-cli') {
      return new CodexCLIProvider({ ...cfg, enabled, command: cfg.command || undefined, localCli });
    }
    if (id === 'claude-code') {
      return new ClaudeCodeProvider({
        ...cfg,
        enabled,
        command: cfg.command || undefined,
        localCli,
      });
    }
    if (!cfg.command) {
      return new BaseCLIProvider({
        id,
        name: cfg.name ?? id,
        command: '',
        enabled,
        localCli,
        setupHint: `Set providers.${id}.command to the local CLI binary.`,
      });
    }
    return new CustomShellProvider({
      id,
      name: cfg.name ?? id,
      command: cfg.command,
      args: cfg.args,
      enabled,
      defaultModel: cfg.model,
      inputMode: cfg.inputMode,
      outputMode: cfg.outputMode,
      shell: cfg.shell,
      timeoutMs: cfg.timeoutMs,
      maxOutputBytes: cfg.maxOutputBytes,
      allowInteractive: cfg.allowInteractive,
      localCli,
      setupHint: `Run ${cfg.command} setup directly, then enable providers.${id}.`,
    });
  }
  return new OpenAICompatibleProvider({
    id,
    name: cfg.name ?? id,
    kind: cfg.type,
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey,
    apiKeyEnv: cfg.apiKeyEnv,
    enabled,
    defaultModel: cfg.model,
    staticModels: cfg.models,
    local: id === 'lmstudio',
  });
}
