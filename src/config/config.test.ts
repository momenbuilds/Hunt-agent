// Validates that the shell-meta
// rejection set matches and that a clean config round-trips through save
// and load.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, load, save } from './config.js';

let tmp = '';
const originalEnv = process.env.HUNT_AGENT_CONFIG;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ha-config-'));
  process.env.HUNT_AGENT_CONFIG = join(tmp, 'config.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (originalEnv === undefined) {
    process.env.HUNT_AGENT_CONFIG = undefined;
  } else {
    process.env.HUNT_AGENT_CONFIG = originalEnv;
  }
});

describe('config', () => {
  it('returns a default config when the file is missing', () => {
    const cfg = load();
    expect(cfg.backend).toBe('');
    expect(cfg.mcp_servers).toEqual([]);
  });

  it('round-trips through save and load', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'groq';
    cfg.model = 'openai/gpt-oss-20b';
    cfg.base_url = 'https://api.groq.com/openai/v1';
    cfg.api_key = 'sk-test';
    cfg.mcp_servers = [{ name: 'browser', command: 'npx', args: ['-y', '@browsermcp/mcp@latest'] }];
    await save(cfg);
    const reloaded = load();
    expect(reloaded.backend).toBe('groq');
    expect(reloaded.model).toBe('openai/gpt-oss-20b');
    expect(reloaded.base_url).toBe('https://api.groq.com/openai/v1');
    expect(reloaded.api_key).toBe('sk-test');
    expect(reloaded.mcp_servers[0]?.command).toBe('npx');
  });

  it('rejects shell-meta in mcp command', async () => {
    const cfg = defaultConfig();
    cfg.mcp_servers = [{ name: 'evil', command: 'npx; rm -rf /', args: [] }];
    await save(cfg);
    expect(() => load()).toThrow(/shell metacharacters/);
  });

  it('rejects pipe in plugin command', async () => {
    const cfg = defaultConfig();
    cfg.plugins = [{ name: 'evil', command: 'sh | nc', args: [], description: '' }];
    await save(cfg);
    expect(() => load()).toThrow(/shell metacharacters/);
  });

  it('rejects command substitution in plugin command', async () => {
    const cfg = defaultConfig();
    cfg.plugins = [{ name: 'evil', command: '$(whoami)', args: [], description: '' }];
    await save(cfg);
    expect(() => load()).toThrow(/shell metacharacters/);
  });

  it('persists tooling_profile through save + load', async () => {
    const cfg = defaultConfig();
    cfg.tooling_profile = 'full';
    await save(cfg);
    const reloaded = load();
    expect(reloaded.tooling_profile).toBe('full');
  });

  it('persists provider registry and model routing config', async () => {
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
    cfg.models.planner = 'claude-code';
    cfg.fallbacks.planner = ['codex-cli', 'openrouter:deepseek/deepseek-r1'];
    cfg.local_cli.timeoutMs = 60_000;
    await save(cfg);
    const reloaded = load();

    expect(reloaded.display_name).toBe('Hunt');
    expect(reloaded.providers['codex-cli']?.command).toBe('codex');
    expect(reloaded.models.planner).toBe('claude-code');
    expect(reloaded.fallbacks.planner).toEqual(['codex-cli', 'openrouter:deepseek/deepseek-r1']);
    expect(reloaded.local_cli.timeoutMs).toBe(60_000);
  });

  it('accepts Gemini as a backend', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'gemini';
    cfg.model = 'models/gemini-3.5-flash';
    cfg.api_key = 'gemini-test';
    await save(cfg);
    const reloaded = load();
    expect(reloaded.backend).toBe('gemini');
    expect(reloaded.model).toBe('models/gemini-3.5-flash');
  });

  it('leaves tooling_profile undefined when never set (signals first run)', () => {
    const cfg = load(); // file doesn't exist → defaults
    expect(cfg.tooling_profile).toBeUndefined();
  });

  it('saved file has 0o600 perms', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'ollama';
    await save(cfg);
    const { statSync } = await import('node:fs');
    const mode = statSync(process.env.HUNT_AGENT_CONFIG ?? '').mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
