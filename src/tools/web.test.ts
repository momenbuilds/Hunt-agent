import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prompter } from '../permission/permission.js';
import { WebFetchTool } from './web.js';

const prompter = {} as Prompter;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebFetchTool', () => {
  it('returns readable text for successful fetches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('<html><body><h1>Hello</h1><script>x()</script></body></html>'),
      ),
    );

    const out = await new WebFetchTool().run(
      { url: 'https://example.com' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('URL: https://example.com');
    expect(out).toContain('Status: 200');
    expect(out).toContain('Hello');
    expect(out).not.toContain('<h1>');
    expect(out).not.toContain('x()');
  });

  it('explains HackerOne platform DNS failures with a public program URL hint', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND platform.hackerone.com'), {
      code: 'ENOTFOUND',
      hostname: 'platform.hackerone.com',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );

    const out = await new WebFetchTool().run(
      { url: 'https://platform.hackerone.com/hackerone/policy_scopes' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('ERROR: fetch failed');
    expect(out).toContain('Code: ENOTFOUND');
    expect(out).toContain('platform.hackerone.com is not a public HackerOne program host');
    expect(out).toContain('https://hackerone.com/hackerone');
  });

  it('rethrows when the caller aborts the request', async () => {
    const ctl = new AbortController();
    ctl.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('aborted');
      }),
    );

    await expect(
      new WebFetchTool().run({ url: 'https://example.com' }, ctl.signal, prompter),
    ).rejects.toThrow('aborted');
  });
});
