// JWT vulnerability fixture app for security testing.
// All data is fictional. DO NOT use in production.
//
// Known finding: "Weak JWT secret allows token forgery"
// The server signs JWTs with the secret "secret" — trivially brute-forceable.

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

// Fictional users — no real credentials
const USERS = {
  alice: { password: 'password1', role: 'user' },
  admin: { password: 'password2', role: 'admin' },
};

// Weak secret — known finding
const JWT_SECRET = 'secret';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = base64url(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest(),
  );
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64').toString());
  } catch {
    return null;
  }
}

let server = null;

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      const user = USERS[parsed.username];
      if (!user || user.password !== parsed.password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid credentials' }));
        return;
      }
      const token = signJWT({ sub: parsed.username, role: user.role, iat: Math.floor(Date.now() / 1000) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token }));
    });
    return;
  }

  if (url.pathname === '/api/admin') {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = verifyJWT(token);
    if (!payload) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'admin panel', secret: 'flag{jwt_weak_secret}' }));
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('JWT test fixture. POST /api/login, GET /api/admin');
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
  start(3002).then(({ url }) => {
    console.log(`JWT fixture running at ${url}`);
    console.log('Try: curl -X POST', url + '/api/login', '-d \'{"username":"alice","password":"password1"}\'');
  });
}
