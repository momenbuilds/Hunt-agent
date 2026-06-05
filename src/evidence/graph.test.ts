import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceStore } from './graph.js';

const SESSION_ID = 'test-session-001';
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hunt-evidence-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('EvidenceStore', () => {
  it('creates nodes and returns their IDs', () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    const id1 = store.addNode('target', { url: 'http://127.0.0.1:3000' });
    const id2 = store.addNode('endpoint', { path: '/api/orders' });
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('creates edges between nodes', () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    const tid = store.addNode('target', { url: 'http://127.0.0.1:3000' });
    const eid = store.addNode('endpoint', { path: '/api/orders' });
    store.addEdge(tid, eid, 'discovered');
    const graph = store.getGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ from: tid, to: eid, type: 'discovered' });
  });

  it('getGraph returns correct structure', () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    store.addNode('target', { url: 'http://127.0.0.1:3000' });
    const graph = store.getGraph();
    expect(graph.sessionId).toBe(SESSION_ID);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.type).toBe('target');
    expect(graph.createdAt).toBeTruthy();
  });

  it('saves evidence graph to file', async () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    store.addNode('target', { url: 'http://127.0.0.1:3000' });
    store.addNode('finding', { title: 'IDOR', severity: 'high' });
    const outPath = await store.save();
    expect(outPath).toContain(`evidence-${SESSION_ID}.json`);
    expect(existsSync(outPath)).toBe(true);
    const content = await readFile(outPath, 'utf8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty('sessionId', SESSION_ID);
    expect(parsed).toHaveProperty('nodes');
    expect(Array.isArray(parsed.nodes)).toBe(true);
  });

  it('redacts secrets in node data', async () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    store.addNode('request', {
      url: 'http://127.0.0.1:3000',
      headers:
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    });
    const outPath = await store.save();
    const content = await readFile(outPath, 'utf8');
    expect(content).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(content).toContain('[REDACTED');
  });

  it('does not contain old branding', async () => {
    const store = new EvidenceStore(SESSION_ID, join(tmpDir, 'evidence'));
    store.addNode('target', { url: 'http://127.0.0.1:3000' });
    const outPath = await store.save();
    const content = await readFile(outPath, 'utf8');
    expect(content).not.toContain('pentesterflow');
    expect(content).not.toContain('PentesterFlow');
  });
});
