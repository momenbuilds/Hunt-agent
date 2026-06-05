import type { ToolCall, ToolSpec } from '../llm/types.js';

export type ProviderKind = 'api' | 'openai-compatible' | 'local-llm' | 'local-cli';

export type ModelRole =
  | 'default'
  | 'planner'
  | 'executor'
  | 'verifier'
  | 'reporter'
  | 'summarizer'
  | 'skill-writer'
  | 'memory'
  | 'cheap'
  | 'large-context';

export const MODEL_ROLES: ModelRole[] = [
  'default',
  'planner',
  'executor',
  'verifier',
  'reporter',
  'summarizer',
  'skill-writer',
  'memory',
  'cheap',
  'large-context',
];

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  longContext: boolean;
  local: boolean;
  requiresApiKey: boolean;
  requiresExternalCli: boolean;
  supportsSystemPrompt: boolean;
  supportsTemperature: boolean;
}

export interface ModelInfo {
  id: string;
  label?: string;
  provider: string;
  contextWindow?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  recommendedRoles?: ModelRole[];
  capabilities: ProviderCapabilities;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallID?: string;
}

export interface AgentRequest {
  role?: ModelRole;
  model?: string;
  messages: AgentMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  tools?: ToolSpec[];
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AgentResponse {
  content: string;
  model: string;
  provider: string;
  message?: AgentMessage;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
  raw?: unknown;
}

export interface AgentStreamChunk {
  content?: string;
  done?: boolean;
  response?: AgentResponse;
}

export interface ProviderStatus {
  id: string;
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  available: boolean;
  healthy: boolean;
  status: 'ready' | 'disabled' | 'missing-api-key' | 'missing-command' | 'unavailable' | 'error';
  message: string;
  setupHint?: string;
  version?: string;
  models?: number;
  warnings?: string[];
}

export interface AgentProvider {
  id: string;
  name: string;
  kind: ProviderKind;
  capabilities: ProviderCapabilities;
  enabled: boolean;
  defaultModel?: string;

  isAvailable(): Promise<boolean>;
  getStatus(): Promise<ProviderStatus>;
  listModels(): Promise<ModelInfo[]>;
  complete(request: AgentRequest): Promise<AgentResponse>;
  stream?(request: AgentRequest): AsyncIterable<AgentStreamChunk>;
}

export interface ProviderConfig {
  type: ProviderKind;
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  command?: string;
  args?: string[];
  inputMode?: 'stdin' | 'argument';
  outputMode?: 'stdout' | 'json';
  shell?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowInteractive?: boolean;
}

export interface LocalCLISettings {
  timeoutMs: number;
  maxOutputBytes: number;
  allowInteractive: boolean;
}

export interface ProviderRuntimeConfig {
  providers: Record<string, ProviderConfig>;
  models: Partial<Record<ModelRole, string>>;
  fallbacks: Partial<Record<ModelRole, string[]>>;
  localCli: LocalCLISettings;
}

export const API_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  jsonMode: true,
  vision: false,
  longContext: true,
  local: false,
  requiresApiKey: true,
  requiresExternalCli: false,
  supportsSystemPrompt: true,
  supportsTemperature: true,
};

export const OPENAI_COMPATIBLE_CAPABILITIES: ProviderCapabilities = {
  ...API_CAPABILITIES,
};

export const LOCAL_LLM_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  jsonMode: true,
  vision: false,
  longContext: false,
  local: true,
  requiresApiKey: false,
  requiresExternalCli: false,
  supportsSystemPrompt: true,
  supportsTemperature: true,
};

export const LOCAL_CLI_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolCalling: false,
  jsonMode: false,
  vision: false,
  longContext: true,
  local: true,
  requiresApiKey: false,
  requiresExternalCli: true,
  supportsSystemPrompt: true,
  supportsTemperature: false,
};
