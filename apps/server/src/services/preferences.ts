import type { ConfigurablePolicyGate } from '@raidrumble/policy';
import type { DashboardView, OverlayLayout } from '../model.js';

/** Keeps presentation preferences and merges explicit channel trust into current policy lists. */
export class HostPreferences {
  private reducedMotion = false;
  private layout: OverlayLayout = 'lower';
  private sound = false;
  private facts: string[] = [];

  constructor(private readonly gate: ConfigurablePolicyGate) {}

  read(): DashboardView['settings'] {
    const config = this.gate.getConfig();
    return {
      ...config.lists,
      mode: config.actions['rumble.start'].mode ?? config.defaults.mode,
      reducedMotion: this.reducedMotion,
      layout: this.layout,
      sound: this.sound,
      facts: [...this.facts],
    };
  }

  configure(settings: DashboardView['settings']): void {
    this.gate.updateLists({
      allow: [...settings.allow],
      block: [...settings.block],
      blockedTerms: [...settings.blockedTerms],
    });
    this.gate.setMode('rumble.start', settings.mode);
    this.gate.setMode('rumble.start.collab', settings.mode);
    this.reducedMotion = settings.reducedMotion;
    this.layout = settings.layout ?? this.layout;
    this.sound = settings.sound ?? this.sound;
    this.facts = settings.facts.slice(0, 3).map((fact) => fact.slice(0, 160));
  }

  trust(login: string): void {
    const lists = this.gate.getConfig().lists;
    if (
      lists.allow.length >= 100 ||
      [...lists.allow, ...lists.block].some((entry) => entry.trim().toLowerCase() === login)
    )
      return;
    this.gate.updateLists({ allow: [...lists.allow, login] });
  }
}
