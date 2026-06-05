import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentEvent } from '../agent/events.js';

export interface SessionDebugLog {
  readonly enabled: boolean;
  readonly path: string;
  write(event: string, data?: Record<string, unknown>): void;
  agentEvent(ev: AgentEvent): void;
}

interface SessionDebugOptions {
  enabled: boolean;
  path?: string;
  sessionID: string;
}

export function createSessionDebugLog(opts: SessionDebugOptions): SessionDebugLog {
  if (!opts.enabled) return disabledSessionDebugLog;

  const path = opts.path && opts.path.length > 0 ? opts.path : defaultDebugPath(opts.sessionID);
  if (!path) return disabledSessionDebugLog;

  let seq = 0;
  const write = (event: string, data?: Record<string, unknown>): void => {
    seq += 1;
    const payload = {
      ts: new Date().toISOString(),
      seq,
      event,
      session_id: opts.sessionID,
      ...(data ?? {}),
    };
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    } catch {
      // Debug logging must never break normal agent usage.
    }
  };

  return {
    enabled: true,
    path,
    write,
    agentEvent: (ev) => write('agent_event', serializeAgentEvent(ev)),
  };
}

export const disabledSessionDebugLog: SessionDebugLog = {
  enabled: false,
  path: '',
  write: () => {},
  agentEvent: () => {},
};

function defaultDebugPath(sessionID: string): string | undefined {
  const home = homedir();
  if (!home) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(home, '.hunt-agent', 'debug', `session-${sessionID}-${stamp}.jsonl`);
}

function serializeAgentEvent(ev: AgentEvent): Record<string, unknown> {
  if (ev.type === 'error') {
    return {
      type: ev.type,
      err: serializeError(ev.err),
    };
  }
  return ev as unknown as Record<string, unknown>;
}

function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}
