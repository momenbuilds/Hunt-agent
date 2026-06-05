import type { ModelRole } from './types.js';

export function fallbackChain(
  role: ModelRole,
  models: Partial<Record<ModelRole, string>>,
  fallbacks: Partial<Record<ModelRole, string[]>> = {},
): string[] {
  const out: string[] = [];
  const push = (ref: string | undefined) => {
    if (ref && !out.includes(ref)) out.push(ref);
  };
  push(models[role]);
  for (const ref of fallbacks[role] ?? []) push(ref);
  if (role !== 'default') push(models.default);
  if (role !== 'default') {
    for (const ref of fallbacks.default ?? []) push(ref);
  }
  return out;
}
