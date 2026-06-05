// Migration check: detects old ~/.pentesterflow paths and returns a warning
// message when the user has not yet migrated to ~/.hunt-agent.
//
// This module does NOT auto-migrate, copy, or delete any files.
// The user must run the migration steps in docs/migration.md manually.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Check whether the user still has a legacy ~/.pentesterflow directory that
 * has not been migrated to ~/.hunt-agent.
 *
 * Returns a human-readable warning string when migration is needed, or
 * null when no migration is required.
 *
 * This function is deliberately read-only — it never writes, copies, moves,
 * or deletes any files.
 */
export function checkMigration(): string | null {
  const home = homedir();
  if (!home) return null;

  const oldConfig = join(home, '.pentesterflow', 'config.json');
  const newConfig = join(home, '.hunt-agent', 'config.json');
  const oldDir = join(home, '.pentesterflow');

  if (!existsSync(oldDir)) return null;
  if (existsSync(newConfig)) return null;

  const lines: string[] = [
    '[hunt-agent] Legacy ~/.pentesterflow data detected.',
    '  Your config and session data have not been migrated to ~/.hunt-agent yet.',
    '',
    '  Quick migration (bash):',
    '    cp -r ~/.pentesterflow ~/.hunt-agent',
    '',
    '  Or migrate only config:',
    `    cp ${oldConfig} ${newConfig}`,
    '',
    '  See docs/migration.md for the full migration guide.',
    '  hunt-agent will work without migrating — it will start fresh.',
  ];

  return lines.join('\n');
}
