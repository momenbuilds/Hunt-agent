import { spawn } from 'node:child_process';
import { constants, accessSync } from 'node:fs';
import { EOL } from 'node:os';
import { redact } from '../../redact/index.js';
import {
  type AgentProvider,
  type AgentRequest,
  type AgentResponse,
  LOCAL_CLI_CAPABILITIES,
  type LocalCLISettings,
  type ModelInfo,
  type ProviderCapabilities,
  type ProviderStatus,
} from '../types.js';

export interface BaseCLIProviderOptions {
  id: string;
  name: string;
  command: string;
  args?: string[];
  enabled?: boolean;
  defaultModel?: string;
  inputMode?: 'stdin' | 'argument';
  outputMode?: 'stdout' | 'json';
  shell?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowInteractive?: boolean;
  setupHint: string;
  warning?: string;
  capabilities?: Partial<ProviderCapabilities>;
  localCli?: LocalCLISettings;
}

export class BaseCLIProvider implements AgentProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'local-cli' as const;
  readonly enabled: boolean;
  readonly command: string;
  readonly args: string[];
  readonly defaultModel?: string;
  readonly capabilities: ProviderCapabilities;

  protected readonly inputMode: 'stdin' | 'argument';
  protected readonly outputMode: 'stdout' | 'json';
  protected readonly shell: boolean;
  protected readonly timeoutMs: number;
  protected readonly maxOutputBytes: number;
  protected readonly allowInteractive: boolean;
  protected readonly setupHint: string;
  protected readonly warning?: string;

  constructor(opts: BaseCLIProviderOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.command = opts.command;
    this.args = opts.args ?? [];
    this.enabled = opts.enabled ?? true;
    this.defaultModel = opts.defaultModel ?? opts.id;
    this.inputMode = opts.inputMode ?? 'stdin';
    this.outputMode = opts.outputMode ?? 'stdout';
    this.shell = opts.shell ?? false;
    this.timeoutMs = opts.timeoutMs ?? opts.localCli?.timeoutMs ?? 120_000;
    this.maxOutputBytes = opts.maxOutputBytes ?? opts.localCli?.maxOutputBytes ?? 200_000;
    this.allowInteractive = opts.allowInteractive ?? opts.localCli?.allowInteractive ?? false;
    this.setupHint = opts.setupHint;
    this.warning = opts.warning;
    this.capabilities = {
      ...LOCAL_CLI_CAPABILITIES,
      ...opts.capabilities,
    };
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getStatus()).healthy;
  }

  async getStatus(): Promise<ProviderStatus> {
    if (!this.enabled) return this.status('disabled', false, 'provider is disabled');
    if (!this.command || (!this.shell && !noShellMeta(this.command))) {
      return this.status('error', false, 'command is missing or contains shell metacharacters');
    }
    if (!(await commandExists(this.command))) {
      return this.status('missing-command', false, `${this.command} was not found on PATH`);
    }
    const version = await this.version();
    return this.status('ready', true, 'ready', version || undefined);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: this.defaultModel ?? this.id,
        provider: this.id,
        label: this.name,
        capabilities: this.capabilities,
      },
    ];
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const status = await this.getStatus();
    if (!status.healthy) {
      throw new Error(`${this.id}: ${status.message}. ${status.setupHint ?? this.setupHint}`);
    }
    if (request.tools?.length && !this.capabilities.toolCalling) {
      throw new Error(
        `${this.id}: local CLI provider cannot emit Hunt-agent tool calls; route this role to a tool-calling API/local LLM provider or run a tools-disabled planning/verification turn.`,
      );
    }
    const prompt = renderPrompt(request);
    const argv = [...this.args];
    let stdin = '';
    if (this.inputMode === 'argument') argv.push(prompt);
    else stdin = prompt;

    const result = await runProcess({
      command: this.command,
      args: argv,
      stdin,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      shell: this.shell,
      parentSignal: request.abortSignal,
    });
    if (result.timedOut) throw new Error(`${this.id}: command timed out after ${this.timeoutMs}ms`);
    if (result.code !== 0) {
      const detail = result.stderr || result.stdout || `exit ${result.code}`;
      throw new Error(`${this.id}: command failed: ${redact.apply(detail)}`);
    }
    const content = this.outputMode === 'json' ? parseJSONOutput(result.stdout) : result.stdout;
    return {
      content,
      model: request.model || this.defaultModel || this.id,
      provider: this.id,
      message: { role: 'assistant', content },
      finishReason: 'stop',
      raw: this.outputMode === 'json' ? redact.apply(result.stdout) : undefined,
    };
  }

  protected async version(): Promise<string> {
    try {
      const result = await runProcess({
        command: this.command,
        args: ['--version'],
        stdin: '',
        timeoutMs: 3_000,
        maxOutputBytes: 8_192,
        shell: false,
      });
      if (result.code === 0) return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? '';
    } catch {
      // Version is informational; unsupported --version should not fail setup.
    }
    return '';
  }

  protected status(
    status: ProviderStatus['status'],
    healthy: boolean,
    message: string,
    version?: string,
  ): ProviderStatus {
    const warnings = this.warning ? [this.warning] : undefined;
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      enabled: this.enabled,
      available: healthy,
      healthy,
      status,
      message,
      setupHint: this.setupHint,
      version,
      warnings,
    };
  }
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  shell?: boolean;
  parentSignal?: AbortSignal;
}

export interface RunProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runProcess(opts: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    let timedOut = false;
    const parent = opts.parentSignal;
    const onParentAbort = () => ctl.abort();
    if (parent?.aborted) ctl.abort();
    else parent?.addEventListener('abort', onParentAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, opts.timeoutMs);
    timer.unref?.();

    const child = spawn(opts.command, opts.args, {
      shell: opts.shell ?? false,
      signal: ctl.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = new ByteAccumulator(opts.maxOutputBytes);
    const stderr = new ByteAccumulator(opts.maxOutputBytes);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
      if (ctl.signal.aborted) {
        resolve({
          code: null,
          signal: null,
          stdout: redact.apply(stdout.toString()),
          stderr: redact.apply(stderr.toString()),
          timedOut,
        });
        return;
      }
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
      resolve({
        code,
        signal,
        stdout: redact.apply(stdout.toString()),
        stderr: redact.apply(stderr.toString()),
        timedOut,
      });
    });

    if (opts.stdin) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export async function commandExists(command: string): Promise<boolean> {
  if (!command || !noShellMeta(command)) return false;
  if (command.includes('/') || command.includes('\\')) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = await runProcess({
      command: probe,
      args: [command],
      stdin: '',
      timeoutMs: 3_000,
      maxOutputBytes: 8_192,
      shell: false,
    });
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function renderPrompt(request: AgentRequest): string {
  const lines: string[] = [];
  if (request.systemPrompt) lines.push(`[system]${EOL}${request.systemPrompt}`);
  for (const message of request.messages) {
    if (!message.content && !message.toolCalls?.length) continue;
    lines.push(`[${message.role}${message.name ? `:${message.name}` : ''}]`);
    if (message.content) lines.push(message.content);
    if (message.toolCalls?.length) {
      for (const tc of message.toolCalls) {
        lines.push(`[tool_call ${tc.function.name}] ${tc.function.arguments}`);
      }
    }
  }
  lines.push('[assistant]');
  return lines.join(EOL);
}

function parseJSONOutput(stdout: string): string {
  const parsed = JSON.parse(stdout) as unknown;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['content', 'text', 'response', 'message']) {
      const value = obj[key];
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        if (typeof nested.content === 'string') return nested.content;
      }
    }
  }
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
}

function noShellMeta(s: string): boolean {
  return !/[|&;<>$`\\\n]/.test(s) && !s.includes('$(') && !s.includes('${');
}

class ByteAccumulator {
  private readonly chunks: Buffer[] = [];
  private retained = 0;
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.total += chunk.length;
    if (this.retained >= this.maxBytes) return;
    const remaining = this.maxBytes - this.retained;
    const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(kept);
    this.retained += kept.length;
  }

  toString(): string {
    let out = Buffer.concat(this.chunks).toString('utf8');
    if (this.total > this.retained) {
      out += `\n[truncated ${this.total - this.retained} bytes]`;
    }
    return out;
  }
}
