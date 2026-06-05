// SARIF 2.1.0 report generator. Produces reports/report.sarif

import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VERSION } from '../version/version.js';
import { loadFindings } from './loader.js';
import type { ReportFinding } from './types.js';

function severityToSarifLevel(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'note';
    default:
      return 'note';
  }
}

function buildSarif(findings: ReportFinding[], version: string): object {
  const rules = findings.map((f) => ({
    id: f.slug,
    name: f.title
      .replace(/[^A-Za-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 64),
    shortDescription: { text: f.title },
    fullDescription: { text: f.impact },
    helpUri: f.url,
    properties: {
      severity: f.severity,
    },
  }));

  const results = findings.map((f) => ({
    ruleId: f.slug,
    level: severityToSarifLevel(f.severity),
    message: {
      text: [f.impact, f.remediation ? `Remediation: ${f.remediation}` : '']
        .filter(Boolean)
        .join('\n\n'),
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.url },
        },
      },
    ],
    properties: {
      method: f.method,
      parameter: f.parameter,
      severity: f.severity,
      reportedAt: f.createdAt,
    },
  }));

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'hunt-agent',
            version,
            informationUri: 'https://github.com/hunt-agent/hunt-agent',
            rules,
          },
        },
        results,
      },
    ],
  };
}

export interface GenerateSARIFOptions {
  findingsDir?: string;
  reportsDir?: string;
}

export async function generateSARIFReport(opts: GenerateSARIFOptions = {}): Promise<string> {
  const findingsDir = opts.findingsDir ?? 'findings';
  const reportsDir = resolve(opts.reportsDir ?? 'reports');
  const findings = loadFindings(findingsDir);
  const sarif = buildSarif(findings, VERSION);
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, 'report.sarif');
  await writeFile(outPath, `${JSON.stringify(sarif, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return outPath;
}
