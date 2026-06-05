import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateJSONReport } from './json.js';
import { generateMarkdownReport } from './markdown.js';
import { generateSARIFReport } from './sarif.js';

const SAMPLE_FINDING_MD = `# IDOR in /api/orders/:id

- **Severity:** high
- **URL:** http://127.0.0.1:3000/api/orders/2
- **Method:** GET
- **Reported at:** 2025-01-01T00:00:00.000Z

## Impact

Users can access other users' orders by incrementing the ID parameter.

## Reproduce

\`\`\`sh
curl -s http://127.0.0.1:3000/api/orders/2
\`\`\`

## Remediation

Verify that the authenticated user owns the resource before returning it.
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hunt-report-test-'));
  const findingsDir = join(tmpDir, 'findings');
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(join(findingsDir, 'idor-in-api-orders.md'), SAMPLE_FINDING_MD);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('markdown report', () => {
  it('generates report.md with correct content', async () => {
    const outPath = await generateMarkdownReport({
      findingsDir: join(tmpDir, 'findings'),
      reportsDir: join(tmpDir, 'reports'),
    });
    expect(outPath).toContain('report.md');
    const content = await readFile(outPath, 'utf8');
    expect(content).toContain('Security Assessment Report');
    expect(content).toContain('IDOR in /api/orders/:id');
    expect(content).toContain('high');
    expect(content).not.toContain('pentesterflow');
    expect(content).not.toContain('PentesterFlow');
  });
});

describe('json report', () => {
  it('generates report.json with correct structure', async () => {
    const outPath = await generateJSONReport({
      findingsDir: join(tmpDir, 'findings'),
      reportsDir: join(tmpDir, 'reports'),
    });
    expect(outPath).toContain('report.json');
    const content = await readFile(outPath, 'utf8');
    const report = JSON.parse(content) as Record<string, unknown>;
    expect(report).toHaveProperty('title');
    expect(report).toHaveProperty('findings');
    expect(Array.isArray(report.findings)).toBe(true);
    const findings = report.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toHaveProperty('title', 'IDOR in /api/orders/:id');
    expect(findings[0]).toHaveProperty('severity', 'high');
    expect(content).not.toContain('pentesterflow');
  });

  it('generates empty findings list when no findings dir', async () => {
    const outPath = await generateJSONReport({
      findingsDir: join(tmpDir, 'no-such-dir'),
      reportsDir: join(tmpDir, 'reports'),
    });
    const content = await readFile(outPath, 'utf8');
    const report = JSON.parse(content) as Record<string, unknown>;
    expect(report.findings).toEqual([]);
  });
});

describe('sarif report', () => {
  it('generates valid SARIF 2.1.0 with $schema and runs', async () => {
    const outPath = await generateSARIFReport({
      findingsDir: join(tmpDir, 'findings'),
      reportsDir: join(tmpDir, 'reports'),
    });
    expect(outPath).toContain('report.sarif');
    const content = await readFile(outPath, 'utf8');
    const sarif = JSON.parse(content) as Record<string, unknown>;
    expect(sarif).toHaveProperty('$schema');
    expect(sarif).toHaveProperty('version', '2.1.0');
    expect(sarif).toHaveProperty('runs');
    expect(Array.isArray(sarif.runs)).toBe(true);
    const runs = sarif.runs as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    const run = runs[0] as Record<string, unknown>;
    expect(run).toHaveProperty('tool');
    expect(run).toHaveProperty('results');
    const results = run.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('ruleId', 'idor-in-api-orders');
    expect(content).not.toContain('pentesterflow');
    expect(content).not.toContain('PentesterFlow');
  });
});
