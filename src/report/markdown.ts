// Markdown report generator. Reads findings/*.md and produces reports/report.md

import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VERSION } from '../version/version.js';
import { loadFindings } from './loader.js';
import type { Report, ReportFinding } from './types.js';

function severityOrder(s: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s] ?? 5;
}

function renderFinding(f: ReportFinding, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index}. ${f.title}`);
  lines.push('');
  lines.push(`- **Severity:** ${f.severity}`);
  lines.push(`- **URL:** ${f.url}`);
  if (f.method) lines.push(`- **Method:** ${f.method}`);
  if (f.parameter) lines.push(`- **Parameter:** ${f.parameter}`);
  lines.push(`- **Reported at:** ${f.createdAt}`);
  lines.push('');
  lines.push('**Impact**');
  lines.push('');
  lines.push(f.impact);
  lines.push('');
  if (f.payload) {
    lines.push('**Payload**');
    lines.push('');
    lines.push('```');
    lines.push(f.payload);
    lines.push('```');
    lines.push('');
  }
  if (f.responseExcerpt) {
    lines.push('**Response excerpt**');
    lines.push('');
    lines.push('```');
    lines.push(f.responseExcerpt);
    lines.push('```');
    lines.push('');
  }
  if (f.curl) {
    lines.push('**Reproduce**');
    lines.push('');
    lines.push('```sh');
    lines.push(f.curl);
    lines.push('```');
    lines.push('');
  }
  if (f.remediation) {
    lines.push('**Remediation**');
    lines.push('');
    lines.push(f.remediation);
    lines.push('');
  }
  return lines.join('\n');
}

export function buildMarkdownReport(report: Report): string {
  const sorted = [...report.findings].sort(
    (a, b) => severityOrder(a.severity) - severityOrder(b.severity),
  );
  const lines: string[] = [];
  lines.push(`# ${report.title}`);
  lines.push('');
  lines.push(`- **Target:** ${report.target}`);
  lines.push(`- **Scope:** ${report.scope}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push(`- **Tool version:** ${report.version}`);
  lines.push('');

  const counts: Record<string, number> = {};
  for (const f of report.findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  lines.push('## Summary');
  lines.push('');
  lines.push(`Total findings: **${report.findings.length}**`);
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    if (counts[sev]) lines.push(`- ${sev}: ${counts[sev]}`);
  }
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push(report.methodology);
  lines.push('');

  lines.push('## Findings');
  lines.push('');
  if (sorted.length === 0) {
    lines.push('No confirmed findings.');
    lines.push('');
  } else {
    for (let i = 0; i < sorted.length; i++) {
      lines.push(renderFinding(sorted[i] as ReportFinding, i + 1));
    }
  }

  lines.push('## Limitations');
  lines.push('');
  lines.push(report.limitations);
  lines.push('');

  return lines.join('\n');
}

export interface GenerateMarkdownOptions {
  findingsDir?: string;
  reportsDir?: string;
  target?: string;
  scope?: string;
}

export async function generateMarkdownReport(opts: GenerateMarkdownOptions = {}): Promise<string> {
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
  const content = buildMarkdownReport(report);
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, 'report.md');
  await writeFile(outPath, content, { encoding: 'utf8', mode: 0o600 });
  return outPath;
}
