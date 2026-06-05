import { BaseCLIProvider, type BaseCLIProviderOptions } from './base-cli-provider.js';

export interface ClaudeCodeProviderOptions
  extends Partial<Omit<BaseCLIProviderOptions, 'id' | 'name' | 'setupHint'>> {
  command?: string;
}

export class ClaudeCodeProvider extends BaseCLIProvider {
  constructor(opts: ClaudeCodeProviderOptions = {}) {
    super({
      id: 'claude-code',
      name: 'Claude Code',
      command: opts.command ?? 'claude',
      args: opts.args ?? ['-p'],
      inputMode: opts.inputMode ?? 'argument',
      outputMode: opts.outputMode ?? 'stdout',
      enabled: opts.enabled,
      timeoutMs: opts.timeoutMs,
      maxOutputBytes: opts.maxOutputBytes,
      allowInteractive: opts.allowInteractive,
      shell: opts.shell,
      localCli: opts.localCli,
      capabilities: {
        supportsSystemPrompt: true,
        longContext: true,
        toolCalling: false,
        ...opts.capabilities,
      },
      setupHint:
        'Install the official Claude Code CLI, run `claude`, and authenticate directly through Anthropic-supported flows. This provider never reads Claude OAuth files, browser cookies, keychain credentials, or Claude.ai login details. Hosted/productized use should rely on Anthropic API keys or supported cloud providers.',
      warning:
        'Claude Code support depends on the installed official CLI exposing stable non-interactive print mode.',
    });
  }
}
