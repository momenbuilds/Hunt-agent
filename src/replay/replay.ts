// Session replay. Reads a saved session file and formats it as readable
// text or JSON. Does NOT re-execute any tools.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apply as redact } from '../redact/redact.js';
import type { Message, SessionFile } from '../session/store.js';

export interface ReplayOptions {
  json?: boolean;
  /** Override the default sessions directory (for testing) */
  sessionsDir?: string;
}

export interface ReplayResult {
  sessionId: string;
  target: string | null;
  messageCount: number;
  toolCallCount: number;
  findingsRefs: string[];
  messages: Array<{
    role: string;
    contentPreview: string;
    toolCalls?: Array<{ name: string; argsPreview: string }>;
  }>;
}

function sessionsDir(override?: string): string {
  return override ?? join(homedir(), '.hunt-agent', 'sessions');
}

function findSessionPath(sessionId: string, dir: string): string | null {
  const direct = join(dir, `${sessionId}.json`);
  if (existsSync(direct)) return direct;
  return null;
}

function summarizeContent(content: string, maxLen = 120): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function extractFindingsRefs(messages: Message[]): string[] {
  const refs: string[] = [];
  const findingPattern = /findings\/([^'">\s]+\.md)/g;
  for (const m of messages) {
    for (const match of m.content.matchAll(findingPattern)) {
      if (match[1] && !refs.includes(match[1])) refs.push(match[1]);
    }
  }
  return refs;
}

export function replaySession(sessionId: string, opts: ReplayOptions = {}): string {
  if (!sessionId || /[/\\]/.test(sessionId) || sessionId.includes('..')) {
    throw new Error(`invalid session id: ${sessionId}`);
  }

  const dir = sessionsDir(opts.sessionsDir);
  const path = findSessionPath(sessionId, dir);
  if (!path) {
    throw new Error(`session not found: ${sessionId} (looked in ${dir})`);
  }

  let raw: SessionFile;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as SessionFile;
  } catch (err) {
    throw new Error(`failed to read session file: ${(err as Error).message}`);
  }

  const messages = raw.messages ?? [];
  let toolCallCount = 0;
  const summarized = messages.map((m) => {
    const contentPreview = summarizeContent(redact(m.content));
    const toolCalls = m.toolCalls?.map((tc) => {
      toolCallCount++;
      let argsPreview = '';
      try {
        const parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        argsPreview = Object.entries(parsed)
          .slice(0, 3)
          .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
          .join(', ');
      } catch {
        argsPreview = tc.function.arguments.slice(0, 80);
      }
      return { name: tc.function.name, argsPreview: redact(argsPreview) };
    });
    return { role: m.role, contentPreview, toolCalls };
  });

  const targetStr = raw.target
    ? (((raw.target as unknown as Record<string, unknown>).baseURL as string | null) ?? null)
    : null;

  const result: ReplayResult = {
    sessionId: raw.id ?? sessionId,
    target: targetStr,
    messageCount: messages.length,
    toolCallCount,
    findingsRefs: extractFindingsRefs(messages),
    messages: summarized,
  };

  if (opts.json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const lines: string[] = [];
  lines.push(`Session: ${result.sessionId}`);
  if (result.target) lines.push(`Target:  ${result.target}`);
  lines.push(`Messages: ${result.messageCount}  Tool calls: ${result.toolCallCount}`);
  if (result.findingsRefs.length > 0) {
    lines.push(`Findings: ${result.findingsRefs.join(', ')}`);
  }
  lines.push('');
  lines.push('--- Transcript ---');
  for (const m of result.messages) {
    lines.push(`[${m.role}] ${m.contentPreview}`);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        lines.push(`  -> tool: ${tc.name}(${tc.argsPreview})`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
