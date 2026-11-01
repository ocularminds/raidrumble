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
          if (validSettings(settings)) this.values.set(key, normalized(settings));
      }
    } catch {
      /* A new install has no saved preferences. */
    }
  }
  get(hostId: string): DashboardView['settings'] | undefined {
    const value = this.values.get(hostId);
    return value && structuredClone(value);
  }
  set(hostId: string, value: DashboardView['settings']): void {
    this.values.set(hostId, normalized(value));
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
    typeof settings.reducedMotion === 'boolean' &&
    (settings.layout === undefined ||
      (typeof settings.layout === 'string' &&
        ['lower', 'rail', 'full'].includes(settings.layout))) &&
    (settings.sound === undefined || typeof settings.sound === 'boolean')
  );
}

function normalized(settings: DashboardView['settings']): DashboardView['settings'] {
  return {
    ...structuredClone(settings),
    layout: settings.layout ?? 'lower',
    sound: settings.sound ?? false,
  };
}
