import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDashboard } from './server.js';
import type { DashboardServer } from './server.js';

const SAMPLE_FINDING_MD = `# Test IDOR Finding

- **Severity:** high
- **URL:** http://127.0.0.1:3000/api/orders/2
- **Reported at:** 2025-01-01T00:00:00.000Z

## Impact

Test finding for dashboard.
`;

let tmpDir: string;
let server: DashboardServer | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hunt-dashboard-test-'));
  const findingsDir = join(tmpDir, 'findings');
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(join(findingsDir, 'test-idor.md'), SAMPLE_FINDING_MD);
});

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

async function fetchJSON(url: string): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url);
  const body = await resp.json();
  return { status: resp.status, body };
}

describe('dashboard server', () => {
  it('starts and returns a URL on localhost', async () => {
    server = await startDashboard({ port: 0, cwd: tmpDir });
    // Server binds to 127.0.0.1
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it('GET /api/health returns 200 with status ok', async () => {
    // Use a fixed high port to avoid conflicts in tests
    server = await startDashboard({ port: 27788, cwd: tmpDir });
    const { status, body } = await fetchJSON(`${server.url}/api/health`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).status).toBe('ok');
  });

  it('GET /api/findings returns 200 with findings array', async () => {
    server = await startDashboard({ port: 27789, cwd: tmpDir });
    const { status, body } = await fetchJSON(`${server.url}/api/findings`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const findings = body as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe('Test IDOR Finding');
  });

  it('GET / returns HTML overview page', async () => {
    server = await startDashboard({ port: 27790, cwd: tmpDir });
    const resp = await fetch(server.url);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('hunt-agent dashboard');
    expect(text).toContain('<!DOCTYPE html>');
  });

  it('server binds to 127.0.0.1 only', async () => {
    server = await startDashboard({ port: 27791, cwd: tmpDir });
    expect(server.url).toContain('127.0.0.1');
    expect(server.url).not.toContain('0.0.0.0');
  });
});
