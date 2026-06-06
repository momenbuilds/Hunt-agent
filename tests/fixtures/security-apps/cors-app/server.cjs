// CORS misconfiguration fixture app for security testing.
// All data is fictional. DO NOT use in production.
//
// Known finding: "CORS allows arbitrary origins"
// The server reflects the Origin header without validation.

'use strict';

const http = require('node:http');

let server = null;

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const origin = req.headers.origin || '';

  // CORS misconfiguration: reflect Origin header unconditionally
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'sensitive data', user: 'alice', balance: 1000 }));
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CORS test fixture. GET /api/data');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function start(port) {
  return new Promise((resolve, reject) => {
    server = http.createServer(handleRequest);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function stop() {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}

module.exports = { start, stop };

if (require.main === module) {
  start(3003).then(({ url }) => {
    console.log(`CORS fixture running at ${url}`);
    console.log('Try: curl -H "Origin: https://evil.example.com"', url + '/api/data', '-v');
  });
}
