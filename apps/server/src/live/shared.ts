import { ContentService } from '@raidrumble/content';
import type { LiveAccount, LiveOptions } from './model.js';
import { reader } from './profile.js';

interface SharedChannel {
  id: string;
  name: string;
}

/** Ephemeral names from the authenticated session; no raw name bypasses content policy. */
export class SharedChannels {
  private readonly sessions = new Map<string, { channels: SharedChannel[] }>();

  constructor(private readonly options: LiveOptions) {}

  get(hostId: string): readonly SharedChannel[] {
    return this.sessions.get(hostId)?.channels.map((channel) => ({ ...channel })) ?? [];
  }

  async update(account: LiveAccount, participants: readonly string[]): Promise<void> {
    const hostId = account.identity.userId;
    const ids = [...new Set(participants)].filter((id) => /^\d+$/.test(id)).slice(0, 100);
    const state = {
      channels: ids.includes(hostId)
        ? ids.map((id, index) => ({ id, name: `Shared Channel ${index + 1}` }))
        : [],
    };
    this.sessions.set(hostId, state);
    if (!state.channels.length) return;
    try {
      const users = await reader(this.options, account.tokens).users(ids);
      if (this.sessions.get(hostId) !== state || account.revoked) return;
      const content = new ContentService(this.options.getGate(hostId));
      const channels = await Promise.all(
        state.channels.map(async (channel) => {
          const user = users.find((user) => user.id === channel.id);
          return {
            id: channel.id,
            name: user ? await content.name(user.display_name, hostId, channel.name) : channel.name,
          };
        }),
      );
      if (this.sessions.get(hostId) === state && !account.revoked) state.channels = channels;
    } catch {
      // Authored fallback labels keep a failed read from affecting session attribution.
    }
  }

  clear(hostId?: string): void {
    if (hostId === undefined) this.sessions.clear();
    else this.sessions.delete(hostId);
  }
}
