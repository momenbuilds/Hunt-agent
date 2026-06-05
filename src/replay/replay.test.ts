import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaySession } from './replay.js';

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const FIXTURE_SESSION = {
  updated_at: '2025-01-01T00:00:00.000Z',
  id: SESSION_ID,
  target: { baseURL: 'http://127.0.0.1:3000' },
  messages: [
    {
      role: 'user',
      content: 'Test for IDOR vulnerabilities on the orders endpoint',
    },
    {
      role: 'assistant',
      content: 'I will test the /api/orders/:id endpoint for IDOR.',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'http',
            arguments: JSON.stringify({ method: 'GET', url: 'http://127.0.0.1:3000/api/orders/1' }),
          },
        },
      ],
    },
    {
      role: 'tool',
      content: '{"id":1,"userId":1,"total":99.99}',
      toolCallID: 'call_1',
    },
  ],
};

const SESSION_WITH_SECRET = {
  updated_at: '2025-01-01T00:00:00.000Z',
  id: SESSION_ID,
  messages: [
    {
      role: 'user',
      content:
        'token is bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    },
  ],
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hunt-replay-test-'));
  mkdirSync(join(tmpDir, 'sessions'), { recursive: true });
  writeFileSync(join(tmpDir, 'sessions', `${SESSION_ID}.json`), JSON.stringify(FIXTURE_SESSION));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('replaySession', () => {
  it('returns readable text output for a valid session', () => {
    const output = replaySession(SESSION_ID, { sessionsDir: join(tmpDir, 'sessions') });
    expect(output).toContain(SESSION_ID);
    expect(output).toContain('http://127.0.0.1:3000');
    expect(output).toContain('[user]');
    expect(output).toContain('[assistant]');
    expect(output).toContain('http');
    expect(output).toContain('IDOR');
  });

  it('returns JSON output when json option is set', () => {
    const output = replaySession(SESSION_ID, { sessionsDir: join(tmpDir, 'sessions'), json: true });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toHaveProperty('sessionId', SESSION_ID);
    expect(parsed).toHaveProperty('target', 'http://127.0.0.1:3000');
    expect(parsed).toHaveProperty('messageCount', 3);
    expect(parsed).toHaveProperty('toolCallCount', 1);
  });

  it('throws clear error for missing session', () => {
    expect(() =>
      replaySession('nonexistent-id', { sessionsDir: join(tmpDir, 'sessions') }),
    ).toThrow('session not found');
  });

  it('throws error for invalid session id with path traversal', () => {
    expect(() => replaySession('../etc/passwd', { sessionsDir: join(tmpDir, 'sessions') })).toThrow(
      'invalid session id',
    );
  });

  it('redacts secrets from session content', () => {
    writeFileSync(
      join(tmpDir, 'sessions', `${SESSION_ID}.json`),
      JSON.stringify(SESSION_WITH_SECRET),
    );
    const output = replaySession(SESSION_ID, { sessionsDir: join(tmpDir, 'sessions') });
    expect(output).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(output).toContain('[REDACTED');
  });
});
