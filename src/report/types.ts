// Report types for hunt-agent. Mirrors the Finding shape from findings/store.ts
// and adds report-level metadata.

import type { Severity } from '../findings/store.js';

export interface ReportFinding {
  title: string;
  severity: Severity;
  url: string;
  parameter?: string;
  payload?: string;
  method?: string;
  responseExcerpt?: string;
  impact: string;
  curl?: string;
  remediation?: string;
  createdAt: string;
  slug: string;
  /** Path to the source .md file this finding was loaded from */
  evidenceFile?: string;
}

export interface Report {
  title: string;
  target: string;
  scope: string;
  generatedAt: string;
  version: string;
  findings: ReportFinding[];
  methodology: string;
  limitations: string;
}
