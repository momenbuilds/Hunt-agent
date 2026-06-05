import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

let tmp = '';

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

describe('CLI entrypoint', () => {
  it('accepts global flags before provider/model subcommands', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'hunt-agent-cli-'));
    const configPath = join(tmp, 'config.json');

    const result = await execa(
      process.execPath,
      ['node_modules/.bin/tsx', 'src/cli/index.ts', '--no-fallback', 'model', 'routes'],
      {
        env: { ...process.env, HUNT_AGENT_CONFIG: configPath },
        reject: false,
        timeout: 10_000,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Model routes');
    expect(result.stderr).not.toContain('Raw mode is not supported');
  });
});
