import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ScopePolicy {
  displayName?: string;
  allowedTargets: string[];
  blockedTargets: string[];
  authorizationNotes?: string;
  maxRequestsPerMinute?: number;
  requireApprovalFor: string[];
  forbiddenActions: string[];
}

export interface ScopeDecision {
  ok: boolean;
  reason?: string;
}

const EMPTY_POLICY: ScopePolicy = {
  allowedTargets: [],
  blockedTargets: [],
  requireApprovalFor: [],
  forbiddenActions: [],
};

export function loadScopePolicy(cwd = process.cwd()): ScopePolicy {
  const path = resolve(cwd, 'scope.yaml');
  if (!existsSync(path)) return EMPTY_POLICY;
  return parseScopePolicy(readFileSync(path, 'utf8'));
}

export function parseScopePolicy(input: string): ScopePolicy {
  const policy: ScopePolicy = {
    ...EMPTY_POLICY,
    allowedTargets: [],
    blockedTargets: [],
    requireApprovalFor: [],
    forbiddenActions: [],
  };
  let section = '';
  for (const raw of input.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const key = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (key?.[1]) {
      section = key[1];
      const value = unquote(key[2] ?? '');
      if (section === 'displayName' && value) policy.displayName = value;
      if (section === 'authorizationNotes' && value) policy.authorizationNotes = value;
      if (section === 'maxRequestsPerMinute' && value) {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) policy.maxRequestsPerMinute = n;
      }
      continue;
    }
    const item = line.match(/^\s*-\s*(.*?)\s*$/);
    if (!item?.[1]) continue;
    const value = unquote(item[1]);
    if (!value) continue;
    switch (section) {
      case 'allowedTargets':
        policy.allowedTargets.push(value);
        break;
      case 'blockedTargets':
        policy.blockedTargets.push(value);
        break;
      case 'requireApprovalFor':
        policy.requireApprovalFor.push(value);
        break;
      case 'forbiddenActions':
        policy.forbiddenActions.push(value);
        break;
    }
  }
  return policy;
}

export function checkURLInScope(rawURL: string, policy = loadScopePolicy()): ScopeDecision {
  const url = parseURL(rawURL);
  if (!url) return { ok: true };

  const blocked = policy.blockedTargets.find((target) => matchesTarget(url, target));
  if (blocked) {
    return { ok: false, reason: `${rawURL} matches blocked target ${blocked}` };
  }

  if (policy.allowedTargets.length > 0) {
    const allowed = policy.allowedTargets.some((target) => matchesTarget(url, target));
    if (!allowed) {
      return {
        ok: false,
        reason: `${rawURL} is outside scope.yaml allowedTargets`,
      };
    }
  }
  return { ok: true };
}

export function extractURLs(text: string): string[] {
  return [...text.matchAll(/\bhttps?:\/\/[^\s'"<>`]+/gi)].map((m) => m[0] ?? '').filter(Boolean);
}

function matchesTarget(url: URL, target: string): boolean {
  const parsed = parseURL(target);
  if (!parsed) return false;
  if (url.protocol !== parsed.protocol || url.hostname !== parsed.hostname) return false;
  if (explicitPort(url) !== explicitPort(parsed)) return false;
  const targetPath = parsed.pathname.replace(/\/+$/, '');
  if (!targetPath) return true;
  return url.pathname === targetPath || url.pathname.startsWith(`${targetPath}/`);
}

function parseURL(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function explicitPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '';
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}
