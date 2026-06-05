// Evidence graph. Tracks the chain of evidence for a security assessment session.
// Each node represents an artifact (request, response, finding, etc.) and edges
// represent relationships between them.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apply as redact } from '../redact/redact.js';

export type EvidenceNodeType =
  | 'target'
  | 'endpoint'
  | 'request'
  | 'response'
  | 'observation'
  | 'hypothesis'
  | 'test'
  | 'finding'
  | 'report'
  | 'model_call';

export type EvidenceEdgeType =
  | 'discovered'
  | 'requested'
  | 'responded_with'
  | 'supports'
  | 'contradicts'
  | 'verified_by'
  | 'generated'
  | 'reported_in';

export interface EvidenceNode {
  id: string;
  type: EvidenceNodeType;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface EvidenceEdge {
  from: string;
  to: string;
  type: EvidenceEdgeType;
}

export interface EvidenceGraph {
  sessionId: string;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  createdAt: string;
}

function newNodeId(): string {
  return randomBytes(8).toString('hex');
}

function redactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      out[k] = redact(v);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactData(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class EvidenceStore {
  private graph: EvidenceGraph;
  private dir: string;

  constructor(
    private sessionId: string,
    dir?: string,
  ) {
    this.dir = dir ?? join(homedir(), '.hunt-agent', 'evidence');
    this.graph = {
      sessionId,
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
    };
  }

  addNode(type: EvidenceNodeType, data: Record<string, unknown>): string {
    const id = newNodeId();
    this.graph.nodes.push({
      id,
      type,
      data: redactData(data),
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  addEdge(from: string, to: string, type: EvidenceEdgeType): void {
    this.graph.edges.push({ from, to, type });
  }

  getGraph(): EvidenceGraph {
    return { ...this.graph, nodes: [...this.graph.nodes], edges: [...this.graph.edges] };
  }

  async save(): Promise<string> {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    const outPath = join(this.dir, `evidence-${this.sessionId}.json`);
    const content = `${JSON.stringify(this.graph, null, 2)}\n`;
    await writeFile(outPath, content, { encoding: 'utf8', mode: 0o600 });
    return outPath;
  }
}
