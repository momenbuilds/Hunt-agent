// Build the right Client from config. The public CLI still accepts the
// legacy single-backend fields, but internally we normalize them into the
// provider registry + model router.

import type { Config, ProviderConfig } from '../config/config.js';
import {
  type ModelRole,
  type ProviderRuntimeConfig,
  RoutedClient,
  createProviderRegistry,
} from '../providers/index.js';
import { ModelRouter } from '../providers/router.js';
import {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  GROQ_DEFAULT_BASE_URL,
  GROQ_DEFAULT_MODEL,
  KIMI_DEFAULT_BASE_URL,
  KIMI_DEFAULT_MODEL,
} from './providers.js';

export interface FactoryOptions {
  noFallback?: boolean;
}

export function newFromConfig(cfg: Config, opts: FactoryOptions = {}): RoutedClient {
  const runtime = runtimeFromConfig(cfg);
  const registry = createProviderRegistry(runtime);
  const router = new ModelRouter({
    registry,
    models: runtime.models,
    fallbacks: runtime.fallbacks,
    configuredProviderIds: configuredProviderIds(runtime),
    noFallback: opts.noFallback,
  });
  return new RoutedClient(router);
}

export function runtimeFromConfig(cfg: Config): ProviderRuntimeConfig {
  const providers: Record<string, ProviderConfig> = { ...cfg.providers };
  const models: Partial<Record<ModelRole, string>> = { ...cfg.models };
  const fallbacks: Partial<Record<ModelRole, string[]>> = { ...cfg.fallbacks };

  const legacyProvider = cfg.provider || (cfg.backend === '' ? 'ollama' : cfg.backend);
  if (legacyProvider) {
    providers[legacyProvider] = {
      ...legacyProviderConfig(cfg, legacyProvider),
      ...(providers[legacyProvider] ?? {}),
      enabled: providers[legacyProvider]?.enabled ?? true,
    };
  }

  if (!models.default) {
    models.default = defaultModelRef(cfg, legacyProvider, providers);
  }

  return {
    providers,
    models,
    fallbacks,
    localCli: {
      timeoutMs: cfg.local_cli.timeoutMs,
      maxOutputBytes: cfg.local_cli.maxOutputBytes,
      allowInteractive: cfg.local_cli.allowInteractive,
    },
  };
}

function legacyProviderConfig(cfg: Config, providerId: string): ProviderConfig {
  switch (providerId) {
    case 'ollama':
      return fullProviderConfig({
        type: 'local-llm',
        enabled: true,
        baseUrl: cfg.base_url,
        model: cfg.model,
      });
    case 'lmstudio':
      return fullProviderConfig({
        type: 'openai-compatible',
        enabled: true,
        baseUrl: cfg.base_url || 'http://localhost:1234/v1',
        model: cfg.model,
      });
    case 'openai-compat':
      return fullProviderConfig({
        type: 'openai-compatible',
        enabled: true,
        baseUrl: cfg.base_url,
        apiKey: cfg.api_key,
        model: cfg.model,
      });
    case 'kimi':
      return fullProviderConfig({
        type: 'openai-compatible',
        enabled: true,
        baseUrl: cfg.base_url || KIMI_DEFAULT_BASE_URL,
        apiKey: cfg.api_key,
        apiKeyEnv: 'MOONSHOT_API_KEY',
        model: cfg.model || KIMI_DEFAULT_MODEL,
      });
    case 'groq':
      return fullProviderConfig({
        type: 'openai-compatible',
        enabled: true,
        baseUrl: cfg.base_url || GROQ_DEFAULT_BASE_URL,
        apiKey: cfg.api_key,
        apiKeyEnv: 'GROQ_API_KEY',
        model: cfg.model || GROQ_DEFAULT_MODEL,
      });
    case 'gemini':
      return fullProviderConfig({
        type: 'api',
        enabled: true,
        baseUrl: cfg.base_url || GEMINI_DEFAULT_BASE_URL,
        apiKey: cfg.api_key,
        apiKeyEnv: 'GEMINI_API_KEY',
        model: cfg.model || GEMINI_DEFAULT_MODEL,
      });
    default:
      return fullProviderConfig({
        type: providerId.endsWith('-cli') ? 'local-cli' : 'openai-compatible',
        enabled: true,
        baseUrl: cfg.base_url,
        apiKey: cfg.api_key,
        model: cfg.model,
      });
  }
}

function fullProviderConfig(
  partial: Partial<ProviderConfig> & { type: ProviderConfig['type'] },
): ProviderConfig {
  return {
    enabled: true,
    name: undefined,
    baseUrl: '',
    apiKeyEnv: '',
    apiKey: '',
    model: '',
    models: [],
    command: '',
    args: [],
    inputMode: 'stdin',
    outputMode: 'stdout',
    shell: false,
    timeoutMs: undefined,
    maxOutputBytes: undefined,
    allowInteractive: false,
    ...partial,
  };
}

function defaultModelRef(
  cfg: Config,
  providerId: string,
  providers: Record<string, ProviderConfig>,
): string {
  if (cfg.model && hasKnownProviderPrefix(cfg.model, providers)) return cfg.model;
  if (cfg.model && providerId) return `${providerId}:${cfg.model}`;
  const providerDefault = providers[providerId]?.model;
  if (providerDefault) return `${providerId}:${providerDefault}`;
  return providerId;
}

function hasKnownProviderPrefix(ref: string, providers: Record<string, ProviderConfig>): boolean {
  const idx = ref.indexOf(':');
  if (idx <= 0) return false;
  const prefix = ref.slice(0, idx);
  return prefix in providers || BUILT_IN_PROVIDER_IDS.has(prefix);
}

const BUILT_IN_PROVIDER_IDS = new Set([
  'ollama',
  'lmstudio',
  'openai-compat',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'gemini',
  'kimi',
  'deepseek',
  'xai',
  'mistral',
  'together',
  'fireworks',
  'cohere',
  'codex-cli',
  'claude-code',
]);

function configuredProviderIds(runtime: ProviderRuntimeConfig): string[] {
  const ids = new Set<string>();
  for (const [id, cfg] of Object.entries(runtime.providers)) {
    if (cfg.enabled !== false) ids.add(id);
  }
  for (const ref of [
    ...Object.values(runtime.models),
    ...Object.values(runtime.fallbacks).flatMap((refs) => refs ?? []),
  ]) {
    if (!ref) continue;
    const idx = ref.indexOf(':');
    ids.add(idx > 0 ? ref.slice(0, idx) : ref);
  }
  return [...ids];
}
