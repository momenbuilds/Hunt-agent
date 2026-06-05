import type { ProviderRegistry } from './registry.js';
import type { ProviderStatus } from './types.js';

export async function providerStatuses(registry: ProviderRegistry): Promise<ProviderStatus[]> {
  return registry.statuses();
}

export function formatProviderStatus(status: ProviderStatus): string {
  const state = status.enabled ? status.status : 'disabled';
  const modelCount = status.models !== undefined ? ` · ${status.models} models` : '';
  const hint = status.healthy ? '' : status.setupHint ? `\n  setup: ${status.setupHint}` : '';
  const warnings = status.warnings?.length ? `\n  warning: ${status.warnings.join('; ')}` : '';
  return `${status.id} · ${status.name} · ${status.kind} · ${state}${modelCount}\n  ${status.message}${hint}${warnings}`;
}

export function formatProviderStatusTable(statuses: ProviderStatus[]): string {
  if (statuses.length === 0) return 'no providers registered';
  return statuses.map(formatProviderStatus).join('\n\n');
}
