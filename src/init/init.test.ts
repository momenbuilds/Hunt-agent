import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInitConfig, runInit } from './init.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hunt-init-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runInit', () => {
  it('creates config.json in temp dir with --yes', async () => {
    const configPath = join(tmpDir, '.hunt-agent', 'config.json');
    await runInit({
      yes: true,
      configPath,
      cwd: tmpDir,
      target: 'http://127.0.0.1:3000',
    });
    expect(existsSync(configPath)).toBe(true);
    const cfg = readInitConfig(configPath);
    expect(cfg).not.toBeNull();
  });

  it('creates scope.yaml in cwd', async () => {
    const configPath = join(tmpDir, 'config.json');
    await runInit({
      yes: true,
      configPath,
      cwd: tmpDir,
      target: 'http://127.0.0.1:3000',
    });
    const scopePath = join(tmpDir, 'scope.yaml');
    expect(existsSync(scopePath)).toBe(true);
    const content = readFileSync(scopePath, 'utf8');
    expect(content).toContain('http://127.0.0.1:3000');
    expect(content).toContain('allowedTargets');
  });

  it('refuses to overwrite existing config without --force', async () => {
    const configPath = join(tmpDir, 'config.json');
    // Create first
    await runInit({ yes: true, configPath, cwd: tmpDir, target: 'http://127.0.0.1:3000' });
    // Write a known value to verify it's preserved
    const original = readFileSync(configPath, 'utf8');
    // Try to overwrite without --force
    await runInit({
      yes: true,
      configPath,
      cwd: tmpDir,
      target: 'http://127.0.0.1:9999',
      force: false,
    });
    const after = readFileSync(configPath, 'utf8');
    // Should remain unchanged
    expect(after).toBe(original);
  });

  it('overwrites existing config with --force', async () => {
    const configPath = join(tmpDir, 'config-force.json');
    await runInit({ yes: true, configPath, cwd: tmpDir, target: 'http://127.0.0.1:3000' });
    await runInit({
      yes: true,
      configPath,
      cwd: tmpDir,
      target: 'http://127.0.0.1:9999',
      force: true,
    });
    const scopePath = join(tmpDir, 'scope.yaml');
    const content = readFileSync(scopePath, 'utf8');
    expect(content).toContain('http://127.0.0.1:9999');
  });

  it('headless init with provider option', async () => {
    const configPath = join(tmpDir, 'config-provider.json');
    await runInit({
      yes: true,
      configPath,
      cwd: tmpDir,
      provider: 'ollama',
      target: 'http://127.0.0.1:8080',
    });
    expect(existsSync(configPath)).toBe(true);
  });
});
