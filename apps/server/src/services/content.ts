import {
  ContentService,
  safeContent,
  type Channels,
  type ContentGenerator,
} from '@raidrumble/content';
import type { ConfigurablePolicyGate } from '@raidrumble/policy';
import type { PreparedMatch, RaidRequest } from '../models/room.js';

/** Staged content never replaces a match after its execution grant is claimed. */
export class ContentPreparation {
  private value?: PreparedMatch;
  readonly ready: Promise<PreparedMatch>;

  constructor(operation: Promise<PreparedMatch>) {
    this.ready = operation
      .catch(() => this.current())
      .then((value) => {
        this.value = value;
        return value;
      });
  }

  current(): PreparedMatch {
    return this.value ?? { content: safeContent(), names: new Map() };
  }
}

/** Prepares only gated match content and display names. */
export class RoomContent {
  private readonly service: ContentService;

  constructor(
    gate: ConfigurablePolicyGate,
    private readonly hostId: string,
    generator?: ContentGenerator,
  ) {
    this.service = new ContentService(gate, generator);
  }

  name(value: string, fallback = 'Viewer'): Promise<string> {
    return this.service.name(value, this.hostId, fallback);
  }

  async labels(channels: Channels) {
    const [hostName, raiderName] = await Promise.all([
      this.name(channels.host.name, 'Home Guard'),
      this.name(channels.raider.name, 'Raiders'),
    ]);
    return { hostName, raiderName };
  }

  stage(request: RaidRequest): ContentPreparation {
    return new ContentPreparation(this.prepare(request));
  }

  private async prepare(request: RaidRequest): Promise<PreparedMatch> {
    const [content, names] = await Promise.all([
      this.service.create(request.channels),
      this.names(request),
    ]);
    return { content, names };
  }

  private async names(request: RaidRequest): Promise<Map<string, string>> {
    if (!request.simulated || request.practice === 'realchat') return new Map();
    const entries = await Promise.all(
      Array.from({ length: 35 }, async (_, index) => {
        const home = index < 20;
        const number = home ? index : index - 20;
        return [
          `${home ? 'home' : 'raider'}${number}`,
          await this.name(`${home ? 'Guardian' : 'Raider'} ${String(number + 1).padStart(2, '0')}`),
        ] as const;
      }),
    );
    return new Map(entries);
  }
}
