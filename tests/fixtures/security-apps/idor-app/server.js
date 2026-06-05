// IDOR vulnerable fixture app for security testing.
// All data is fictional. DO NOT use in production.
//
// Known finding: "IDOR in /api/orders/:id — can access other users' orders"
// The /api/orders/:id endpoint returns order data without checking user ownership.

'use strict';

const http = require('node:http');

// Fictional orders database — no real user data
const ORDERS = {
  1: { id: 1, userId: 1, username: 'alice', total: 42.0, items: ['widget-A'] },
  2: { id: 2, userId: 2, username: 'bob', total: 99.99, items: ['widget-B', 'widget-C'] },
  3: { id: 3, userId: 3, username: 'carol', total: 7.5, items: ['widget-D'] },
};

let server = null;

function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1`);

  // IDOR: no auth check — any client can access any order by ID
  const orderMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
  if (orderMatch) {
    const id = parseInt(orderMatch[1], 10);
    const order = ORDERS[id];
    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'order not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(order));
    return;
  }

  if (url.pathname === '/api/orders') {
    // Returns only current user's orders — simulate authenticated as user 1
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([ORDERS[1]]));
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('IDOR test fixture. GET /api/orders/:id');
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

// Allow direct execution for manual testing
if (require.main === module) {
  start(3001).then(({ url }) => {
    console.log(`IDOR fixture running at ${url}`);
    console.log('Try: curl', url + '/api/orders/2', '(as user 1 — IDOR)');
  });
}
