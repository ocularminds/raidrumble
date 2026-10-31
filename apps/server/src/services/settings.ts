import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DashboardView } from '../model.js';

/** Stores channel preferences only; no tokens or individual chatters. */
export class SettingsStore {
  private readonly values = new Map<string, DashboardView['settings']>();
  constructor(private readonly path?: string) {
    if (!path) return;
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof value === 'object' && value !== null) {
        for (const [key, settings] of Object.entries(value))
          if (validSettings(settings)) this.values.set(key, settings);
      }
    } catch {
      /* A new install has no saved preferences. */
    }
  }
  get(hostId: string): DashboardView['settings'] | undefined {
    return this.values.get(hostId);
  }
  set(hostId: string, value: DashboardView['settings']): void {
    this.values.set(hostId, structuredClone(value));
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(Object.fromEntries(this.values)), {
      mode: 0o600,
    });
    renameSync(`${this.path}.tmp`, this.path);
  }
}

export function validSettings(value: unknown): value is DashboardView['settings'] {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    ['allow', 'block', 'blockedTerms', 'facts'].every(
      (key) =>
        Array.isArray(settings[key]) &&
        (settings[key] as unknown[]).length <= 100 &&
        (settings[key] as unknown[]).every(
          (item) => typeof item === 'string' && item.length <= 160,
        ),
    ) &&
    (settings.mode === 'shadow' || settings.mode === 'enforce') &&
    typeof settings.reducedMotion === 'boolean'
  );
}
