import { BaseCLIProvider, type BaseCLIProviderOptions } from './base-cli-provider.js';

export interface CodexCLIProviderOptions
  extends Partial<Omit<BaseCLIProviderOptions, 'id' | 'name' | 'setupHint'>> {
  command?: string;
}

export class CodexCLIProvider extends BaseCLIProvider {
  constructor(opts: CodexCLIProviderOptions = {}) {
    super({
      id: 'codex-cli',
      name: 'Codex CLI',
      command: opts.command ?? 'codex',
      args: opts.args ?? ['exec', '--skip-git-repo-check', '-'],
      inputMode: opts.inputMode ?? 'stdin',
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
        'Install the official Codex CLI, run `codex`, and authenticate directly through the official flow. This provider never reads Codex token files or browser/keychain credentials. Non-interactive completion requires a supported `codex exec` mode.',
      warning:
        'Codex CLI support depends on the installed official CLI exposing stable non-interactive execution.',
    });
  }
}
