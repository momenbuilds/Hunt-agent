import { describe, expect, it } from 'vitest';
import {
  checkMethodInScope,
  checkPathInScope,
  checkURLInScope,
  parseScopePolicy,
  validateScopeFile,
} from './policy.js';

describe('scope policy', () => {
  it('parses allowed and blocked targets from scope.yaml text', () => {
    const policy = parseScopePolicy(`
project:
  displayName: Hunt
scope:
  allowedTargets:
    - https://staging.acme.com
    - https://api-staging.acme.com/v1
  blockedTargets:
    - https://acme.com
  requireApprovalFor:
    - shell
  forbiddenActions:
    - destructive_testing
`);

    expect(policy.allowedTargets).toEqual([
      'https://staging.acme.com',
      'https://api-staging.acme.com/v1',
    ]);
    expect(policy.blockedTargets).toEqual(['https://acme.com']);
    expect(policy.requireApprovalFor).toEqual(['shell']);
    expect(policy.forbiddenActions).toEqual(['destructive_testing']);
  });

  it('blocks out-of-scope targets when allowedTargets is present', () => {
    const policy = parseScopePolicy(`
scope:
  allowedTargets:
    - https://staging.acme.com
  blockedTargets:
    - https://prod.acme.com
`);

    expect(checkURLInScope('https://staging.acme.com/api/users', policy).ok).toBe(true);
    expect(checkURLInScope('https://api.acme.com/users', policy)).toEqual({
      ok: false,
      reason: 'https://api.acme.com/users is outside scope.yaml allowedTargets',
    });
    expect(checkURLInScope('https://prod.acme.com/login', policy).reason).toContain(
      'blocked target',
    );
  });

  it('parses allowedMethods and blockedMethods', () => {
    const policy = parseScopePolicy(`
scope:
  allowedTargets:
    - http://127.0.0.1:3000
  allowedMethods:
    - GET
    - POST
  blockedMethods:
    - DELETE
`);
    expect(policy.allowedMethods).toEqual(['GET', 'POST']);
    expect(policy.blockedMethods).toEqual(['DELETE']);
  });

  it('parses blockedPaths', () => {
    const policy = parseScopePolicy(`
scope:
  allowedTargets:
    - http://127.0.0.1:3000
  blockedPaths:
    - /admin
    - /internal
`);
    expect(policy.blockedPaths).toEqual(['/admin', '/internal']);
  });

  it('checkMethodInScope blocks disallowed methods', () => {
    const policy = parseScopePolicy(`
scope:
  allowedMethods:
    - GET
    - POST
`);
    expect(checkMethodInScope('GET', policy).ok).toBe(true);
    expect(checkMethodInScope('DELETE', policy).ok).toBe(false);
    expect(checkMethodInScope('DELETE', policy).reason).toContain('not in allowedMethods');
  });

  it('checkMethodInScope blocks explicitly blocked methods', () => {
    const policy = parseScopePolicy(`
scope:
  blockedMethods:
    - DELETE
    - PUT
`);
    expect(checkMethodInScope('GET', policy).ok).toBe(true);
    expect(checkMethodInScope('DELETE', policy).ok).toBe(false);
    expect(checkMethodInScope('DELETE', policy).reason).toContain('blocked by scope policy');
  });

  it('checkPathInScope blocks paths matching blockedPaths', () => {
    const policy = parseScopePolicy(`
scope:
  blockedPaths:
    - /admin
    - /internal
`);
    expect(checkPathInScope('/api/users', policy).ok).toBe(true);
    expect(checkPathInScope('/admin', policy).ok).toBe(false);
    expect(checkPathInScope('/admin/settings', policy).ok).toBe(false);
    expect(checkPathInScope('/internal/api', policy).ok).toBe(false);
  });

  it('validateScopeFile returns error for missing file', () => {
    const result = validateScopeFile('/tmp/does-not-exist-hunt-test.yaml');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });
});
