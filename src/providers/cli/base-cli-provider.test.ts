import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseCLIProvider } from './base-cli-provider.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { CodexCLIProvider } from './codex-cli.js';

const node = process.execPath;

function nodeProvider(script: string, opts: { timeoutMs?: number; maxOutputBytes?: number } = {}) {
  return new BaseCLIProvider({
    id: 'node-cli',
    name: 'Node CLI',
    command: node,
    args: ['-e', script],
    inputMode: 'stdin',
    outputMode: 'stdout',
    timeoutMs: opts.timeoutMs,
    maxOutputBytes: opts.maxOutputBytes,
    setupHint: 'node test helper',
  });
}

let tmp = '';

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

describe('BaseCLIProvider', () => {
  it('reports a missing local CLI command', async () => {
    const provider = new BaseCLIProvider({
      id: 'missing',
      name: 'Missing',
      command: 'definitely-not-a-real-hunt-agent-command',
      setupHint: 'install it',
    });

    const status = await provider.getStatus();
    expect(status.status).toBe('missing-command');
    expect(status.setupHint).toContain('install it');
  });

  it('kills timed-out local CLI commands', async () => {
    const provider = nodeProvider('setTimeout(() => {}, 5000)', { timeoutMs: 50 });

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/timed out/);
  });

  it('limits captured CLI output bytes', async () => {
    const provider = nodeProvider('process.stdout.write("x".repeat(1000))', {
      maxOutputBytes: 20,
    });

    const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(response.content.length).toBeLessThan(80);
    expect(response.content).toContain('[truncated');
  });

  it('redacts secrets surfaced by CLI stderr', async () => {
    const provider = nodeProvider(
      'process.stderr.write("token=sk_live_12345678901234567890"); process.exit(2)',
    );

    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/REDACTED/);
  });
});

describe('official local CLI providers', () => {
  it('Codex CLI provider uses official exec mode that works outside git repos', () => {
    const provider = new CodexCLIProvider();

    expect(provider.command).toBe('codex');
    expect(provider.args).toEqual(['exec', '--skip-git-repo-check', '-']);
    expect(provider.inputMode).toBe('stdin');
  });

  it('Codex CLI provider does not read credential files', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'pf-codex-home-'));
    writeFileSync(join(tmp, 'codex-token.json'), 'SECRET_CREDENTIAL_SHOULD_NOT_BE_READ');
    const oldHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
      const provider = new CodexCLIProvider({
        command: node,
        args: [
          '-e',
          'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("ok"))',
        ],
        inputMode: 'stdin',
      });
      const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(response.content).toBe('ok');
      expect(response.content).not.toContain('SECRET_CREDENTIAL');
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it('Claude Code provider does not read credential files', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'pf-claude-home-'));
    writeFileSync(join(tmp, 'claude-oauth.json'), 'SECRET_CREDENTIAL_SHOULD_NOT_BE_READ');
    const oldHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
      const provider = new ClaudeCodeProvider({
        command: node,
        args: ['-e', 'process.stdout.write(process.argv.at(-1) ? "ok" : "missing")'],
        inputMode: 'argument',
      });
      const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(response.content).toBe('ok');
      expect(response.content).not.toContain('SECRET_CREDENTIAL');
    } finally {
      process.env.HOME = oldHome;
    }
  });
});
