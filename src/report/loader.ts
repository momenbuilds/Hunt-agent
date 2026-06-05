// Loads findings from ./findings/*.md files and parses them into ReportFinding objects.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Severity } from '../findings/store.js';
import type { ReportFinding } from './types.js';

function parseSeverity(value: string): Severity {
  const lower = value.trim().toLowerCase() as Severity;
  const valid: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  return valid.includes(lower) ? lower : 'info';
}

function extractField(lines: string[], label: string): string {
  const prefix = `- **${label}:**`;
  const line = lines.find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function extractSection(lines: string[], heading: string): string {
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const slice = end < 0 ? lines.slice(start + 1) : lines.slice(start + 1, end);
  // Strip code fences if present
  const inner = slice.filter((l) => l !== '```' && l !== '```sh');
  return inner.join('\n').trim();
}

export function parseMarkdownFinding(content: string, filePath: string): ReportFinding | null {
  const lines = content.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  if (!titleLine) return null;
  const title = titleLine.slice(2).trim();
  const slug = filePath.replace(/.*\//, '').replace(/\.md$/, '');
  const severity = parseSeverity(extractField(lines, 'Severity'));
  const url = extractField(lines, 'URL');
  const method = extractField(lines, 'Method') || undefined;
  const parameter = extractField(lines, 'Parameter') || undefined;
  const createdAt = extractField(lines, 'Reported at') || new Date().toISOString();
  const impact = extractSection(lines, 'Impact');
  const payload = extractSection(lines, 'Payload') || undefined;
  const responseExcerpt = extractSection(lines, 'Response excerpt') || undefined;
  const curl = extractSection(lines, 'Reproduce') || undefined;
  const remediation = extractSection(lines, 'Remediation') || undefined;
  return {
    title,
    severity,
    url,
    method,
    parameter,
    payload,
    responseExcerpt,
    impact,
    curl,
    remediation,
    createdAt,
    slug,
    evidenceFile: filePath,
  };
}

export function loadFindings(findingsDir = 'findings'): ReportFinding[] {
  const dir = resolve(findingsDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const findings: ReportFinding[] = [];
  for (const file of files) {
    const full = join(dir, file);
    try {
      const content = readFileSync(full, 'utf8');
      const finding = parseMarkdownFinding(content, full);
      if (finding) findings.push(finding);
    } catch {
      // skip unreadable files
    }
  }
  return findings;
}
