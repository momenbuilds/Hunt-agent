// Init command. Creates config.json and scope.yaml for a new hunt-agent workspace.
// Does NOT overwrite existing config unless --force is passed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface InitOptions {
  provider?: string;
  target?: string;
  yes?: boolean;
  force?: boolean;
  configPath?: string;
  cwd?: string;
}

const DEFAULT_SCOPE_YAML = (target: string) => `# hunt-agent scope configuration
# Only test targets listed in allowedTargets.
# See docs/scope-policy.md for full documentation.

displayName: My Security Assessment

scope:
  allowedTargets:
    - ${target}
  blockedTargets: []
  requireApprovalFor:
    - shell
  forbiddenActions:
    - destructive_testing
`;

function defaultConfigPath(): string {
  const envPath = process.env.HUNT_AGENT_CONFIG;
  if (envPath) return envPath;
  return join(homedir(), '.hunt-agent', 'config.json');
}

function defaultConfig(opts: InitOptions): Record<string, unknown> {
  return {
    backend: opts.provider === 'claude-code' ? '' : '',
    provider: opts.provider ?? 'claude-code',
    model: '',
    base_url: '',
    api_key: '',
    models: { default: opts.provider ? `${opts.provider}:` : '' },
    fallbacks: {},
    providers: {
      [opts.provider ?? 'claude-code']: {
        type: 'local-cli',
        enabled: true,
        command: opts.provider === 'claude-code' ? 'claude' : (opts.provider ?? 'claude'),
        args: ['-p'],
        inputMode: 'argument',
        outputMode: 'stdout',
      },
    },
    mcp_servers: [],
    skills_dirs: [],
    disabled_skills: [],
    max_steps: 0,
    auto_compact_threshold: 0,
    streaming_enabled: true,
    thinking_enabled: false,
    plugins: [],
  };
}

export async function runInit(opts: InitOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = opts.configPath ?? defaultConfigPath();
  const scopePath = resolve(cwd, 'scope.yaml');
  const target = opts.target ?? 'http://127.0.0.1:3000';

  const configExists = existsSync(configPath);
  const scopeExists = existsSync(scopePath);

  if (configExists && !opts.force) {
    process.stdout.write(
      `Config already exists at ${configPath} — skipping (use --force to overwrite)\n`,
    );
  } else {
    const dir = join(configPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const cfg = defaultConfig(opts);
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Created config: ${configPath}\n`);
  }

  if (scopeExists && !opts.force) {
    process.stdout.write(`scope.yaml already exists at ${scopePath} — skipping\n`);
  } else {
    writeFileSync(scopePath, DEFAULT_SCOPE_YAML(target), { encoding: 'utf8' });
    process.stdout.write(`Created scope: ${scopePath}\n`);
  }

  process.stdout.write(`
Next steps:
  1. Edit ${scopePath} to define your target(s)
  2. Run: hunt-agent scope validate
  3. Run: hunt-agent to start the interactive assessment
  4. Or run: hunt-agent assess --headless --objective "test target" --scope scope.yaml
`);
}

/** Read config file content for tests / verification */
export function readInitConfig(configPath?: string): Record<string, unknown> | null {
  const path = configPath ?? defaultConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
