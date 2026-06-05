// JSON report generator. Produces reports/report.json

import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VERSION } from '../version/version.js';
import { loadFindings } from './loader.js';
import type { Report } from './types.js';

export interface GenerateJSONOptions {
  findingsDir?: string;
  reportsDir?: string;
  target?: string;
  scope?: string;
}

export async function generateJSONReport(opts: GenerateJSONOptions = {}): Promise<string> {
  const findingsDir = opts.findingsDir ?? 'findings';
  const reportsDir = resolve(opts.reportsDir ?? 'reports');
  const findings = loadFindings(findingsDir);
  const report: Report = {
    title: 'Security Assessment Report',
    target: opts.target ?? '(not specified)',
    scope: opts.scope ?? 'See scope.yaml',
    generatedAt: new Date().toISOString(),
    version: VERSION,
    findings,
    methodology:
      'Automated and manual security testing using hunt-agent. Findings represent confirmed vulnerabilities with reproduction steps.',
    limitations:
      'This report covers the assessment period only. New vulnerabilities may emerge after the report date. Testing was limited to authorized targets.',
  };
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, 'report.json');
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return outPath;
}
