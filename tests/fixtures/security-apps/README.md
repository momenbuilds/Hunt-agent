# Security Testing Fixture Apps

**SAFETY NOTICE**: These fixture apps are intentionally vulnerable for controlled security testing.
They MUST only be used for:
- Local development and testing of hunt-agent
- Automated CI/CD pipeline tests
- Learning and demonstration purposes

**DO NOT** deploy these fixtures to any public-facing server or network.
All data is fictional. No real users, credentials, or sensitive information is used.

## Fixtures

### idor-app

Simple Node.js HTTP server with an IDOR (Insecure Direct Object Reference) vulnerability.

- `GET /api/orders/:id` — Returns order data without checking user ownership (IDOR)
- **Known finding**: "IDOR in /api/orders/:id — can access other users' orders"
- **Usage**: `const { start, stop } = require('./idor-app/server.js'); await start(0);`

### jwt-app

Simple Node.js HTTP server with a weak JWT secret vulnerability.

- `POST /api/login` — Returns a JWT signed with the weak secret `"secret"`
- `GET /api/admin` — Protected endpoint, requires valid JWT with `role: admin`
- **Known finding**: "Weak JWT secret allows token forgery"
- **Usage**: `const { start, stop } = require('./jwt-app/server.js'); await start(0);`

### cors-app

Simple Node.js HTTP server with a CORS misconfiguration.

- `GET /api/data` — Returns data with `Access-Control-Allow-Origin: <origin>` reflected
- **Known finding**: "CORS allows arbitrary origins"
- **Usage**: `const { start, stop } = require('./cors-app/server.js'); await start(0);`

## API

Each fixture exports:
- `start(port)` — Starts the server on the given port (0 = random). Returns `{ port, url }`.
- `stop()` — Stops the server.

## Example

```js
const { start, stop } = require('./idor-app/server.js');
const { port, url } = await start(0);
console.log(`Running at ${url}`);
// ... run tests ...
await stop();
```
