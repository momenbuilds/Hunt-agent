import { BaseCLIProvider, type BaseCLIProviderOptions } from './base-cli-provider.js';

export interface CustomShellProviderOptions extends BaseCLIProviderOptions {
  id: string;
}

export class CustomShellProvider extends BaseCLIProvider {
  constructor(opts: CustomShellProviderOptions) {
    super({
      ...opts,
      enabled: opts.enabled ?? false,
      setupHint:
        opts.setupHint ||
        'Custom shell providers are disabled by default. Enable explicitly in config and use command + args arrays. Avoid shell interpolation unless shell=true is intentionally set.',
      warning:
        opts.warning ??
        'Custom shell providers can execute local commands. Keep them explicit, non-interactive, timeout-bounded, and scoped to trusted binaries.',
    });
  }
}
