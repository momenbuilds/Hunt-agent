import { describe, expect, it } from 'vitest';
import { checkURLInScope, parseScopePolicy } from './policy.js';

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
});
