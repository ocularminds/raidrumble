import { randomBytes } from 'node:crypto';
import type { WarlordLink, WarlordTarget } from './model.js';

export class WarlordLinks {
  private readonly targets = new Map<string, WarlordTarget>();

  constructor(
    private readonly baseUrl: string,
    private readonly dashboardUrl: string,
    private readonly now: () => number,
  ) {}

  create(hostId: string, raiderId: string, matchId: string): WarlordLink {
    for (const [key, value] of this.targets)
      if (value.expiresAt <= this.now()) this.targets.delete(key);
    if (this.targets.size >= 10_000) throw new Error('Too many active Warlord links');
    const token = randomBytes(32).toString('base64url');
    this.targets.set(token, { hostId, raiderId, matchId, expiresAt: this.now() + 10 * 60_000 });
    return {
      token,
      url: this.url(token),
      loginUrl: new URL(`/auth/warlord?token=${token}`, this.baseUrl).toString(),
    };
  }

  get(token: string): WarlordTarget | undefined {
    const target = this.targets.get(token);
    if (!target) return undefined;
    if (target.expiresAt <= this.now()) {
      this.targets.delete(token);
      return undefined;
    }
    return { ...target };
  }

  url(token: string): string {
    return new URL(`/warlord/${encodeURIComponent(token)}`, this.dashboardUrl).toString();
  }

  clearMatch(matchId: string): void {
    for (const [key, target] of this.targets)
      if (target.matchId === matchId) this.targets.delete(key);
  }

  clear(): void {
    this.targets.clear();
  }
}
