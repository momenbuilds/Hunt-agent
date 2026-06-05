// Minimal dashboard HTTP server. Binds to 127.0.0.1 only.
// No external dependencies — uses Node.js built-in http module.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadFindings } from '../report/loader.js';
import * as sessionStore from '../session/store.js';
import { VERSION } from '../version/version.js';

export interface DashboardOptions {
  port?: number;
  open?: boolean;
  cwd?: string;
}

export interface DashboardServer {
  url: string;
  stop(): Promise<void>;
}

const OVERVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>hunt-agent dashboard</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a1a2e}
h1{color:#e94560;border-bottom:2px solid #e94560;padding-bottom:8px}
h2{color:#16213e;margin-top:32px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;margin:2px}
.critical{background:#ff4444;color:#fff}
.high{background:#ff8800;color:#fff}
.medium{background:#ffcc00;color:#000}
.low{background:#44aa44;color:#fff}
.info{background:#4488cc;color:#fff}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{background:#f5f5f5;font-weight:600}
a{color:#e94560;text-decoration:none}
a:hover{text-decoration:underline}
.nav{margin-bottom:24px}
.nav a{margin-right:16px;font-weight:600}
</style>
</head>
<body>
<h1>hunt-agent dashboard</h1>
<div class="nav">
  <a href="/">Overview</a>
  <a href="/api/findings">Findings JSON</a>
  <a href="/api/sessions">Sessions JSON</a>
  <a href="/api/health">Health</a>
</div>
<p>Loading findings...</p>
<script>
async function load() {
  const [findings, sessions] = await Promise.all([
    fetch('/api/findings').then(r => r.json()),
    fetch('/api/sessions').then(r => r.json()),
  ]);
  const severityBadge = s => '<span class="badge ' + s + '">' + s + '</span>';
  document.querySelector('p').remove();
  const main = document.querySelector('body');
  main.insertAdjacentHTML('beforeend',
    '<h2>Findings (' + findings.length + ')</h2>' +
    (findings.length === 0 ? '<p>No confirmed findings yet.</p>' :
      '<table><thead><tr><th>Title</th><th>Severity</th><th>URL</th></tr></thead><tbody>' +
      findings.map(f =>
        '<tr><td>' + (f.title||'') + '</td><td>' + severityBadge(f.severity) + '</td><td>' + (f.url||'') + '</td></tr>'
      ).join('') + '</tbody></table>') +
    '<h2>Recent Sessions (' + sessions.length + ')</h2>' +
    (sessions.length === 0 ? '<p>No sessions yet.</p>' :
      '<table><thead><tr><th>ID</th><th>Updated</th><th>Preview</th></tr></thead><tbody>' +
      sessions.slice(0,20).map(s =>
        '<tr><td><code>' + s.id + '</code></td><td>' + new Date(s.updatedAt).toLocaleString() + '</td><td>' + (s.preview||'') + '</td></tr>'
      ).join('') + '</tbody></table>')
  );
}
load().catch(e => { document.querySelector('p').textContent = 'Error: ' + e.message; });
</script>
</body>
</html>`;

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendHTML(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

function handleRequest(req: IncomingMessage, res: ServerResponse, cwd: string): void {
  const url = req.url ?? '/';
  if (url === '/' || url === '') {
    sendHTML(res, OVERVIEW_HTML);
    return;
  }
  if (url === '/api/health') {
    sendJSON(res, 200, { status: 'ok', version: VERSION });
    return;
  }
  if (url === '/api/findings') {
    const findingsDir = resolve(cwd, 'findings');
    const findings = loadFindings(findingsDir);
    sendJSON(res, 200, findings);
    return;
  }
  if (url === '/api/sessions') {
    const dir = join(homedir(), '.hunt-agent', 'sessions');
    const sessions = sessionStore.listDir(dir).map((s) => ({
      id: s.id,
      path: s.path,
      updatedAt: s.updatedAt.toISOString(),
      preview: s.preview,
    }));
    sendJSON(res, 200, sessions);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

export async function startDashboard(opts: DashboardOptions = {}): Promise<DashboardServer> {
  const port = opts.port ?? 7788;
  const cwd = opts.cwd ?? process.cwd();

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      try {
        handleRequest(req, res, cwd);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : port;
      const url = `http://127.0.0.1:${actualPort}`;
      resolve({
        url,
        stop(): Promise<void> {
          return new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
        },
      });
    });
  });
}
