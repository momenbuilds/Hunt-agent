// Skill discovery precedence. Injectable cwd/home keep it deterministic.

import { describe, expect, it } from 'vitest';
import { skillSearchDirs } from './discovery.js';

describe('skillSearchDirs', () => {
  it('orders builtin → project → managed → personal → configured (lowest to highest precedence)', () => {
    const dirs = skillSearchDirs(['/cfg/skills'], '/proj', '/home');
    expect(dirs).toEqual([
      '/proj/skills',
      '/proj/.hunt-agent/skills',
      '/home/.hunt-agent/builtin-skills',
      '/home/.hunt-agent/skills',
      '/cfg/skills',
    ]);
  });

  it('includes project-local, managed, and personal skill dirs', () => {
    const dirs = skillSearchDirs([], '/proj', '/home');
    expect(dirs).toContain('/proj/.hunt-agent/skills');
    expect(dirs).toContain('/home/.hunt-agent/builtin-skills');
    expect(dirs).toContain('/home/.hunt-agent/skills');
  });

  it('appends configured dirs last so they win on collision', () => {
    const dirs = skillSearchDirs(['/a', '/b'], '/proj', '/home');
    expect(dirs.slice(-2)).toEqual(['/a', '/b']);
  });
});
