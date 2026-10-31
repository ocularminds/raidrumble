import { defaultPolicy, type PolicyConfig } from '@raidrumble/policy';
import { demoChannels, type ChannelProfile, type ContentGenerator } from '@raidrumble/content';
import { randomUUID } from 'node:crypto';
import { Ledger, RegularStore } from '@raidrumble/ledger';
import type { Scenario } from '../model.js';
import { Room, type CompletedMatch, type RaidRequest } from './room.js';
import { SettingsStore } from './settings.js';
import { HostHistory } from './history.js';

export interface RoomsOptions {
  ledger: Ledger;
  settings: SettingsStore;
  config?: PolicyConfig;
  generator?: ContentGenerator;
  quiet?: boolean;
  now?: () => number;
  regulars?: RegularStore;
  regularsPath?: string;
  gateKind?: 'local' | 'decionis';
}

export class Rooms {
  readonly all = new Map<string, Room>();
  readonly profiles = new Map<string, ChannelProfile>();
  readonly shared = new Map<string, readonly string[]>();
  readonly rewardIds = new Map<string, string>();
  private readonly raidHistory = new Map<string, number[]>();
  private readonly regulars: RegularStore;
  /** Until Twitch supplies a stream id, a server session is the explicit history boundary. */
  private readonly session = `server:${randomUUID()}`;
  private strangerSequence = 0;
  private closing?: Promise<void>;

  constructor(private readonly options: RoomsOptions) {
    this.regulars = options.regulars ?? new RegularStore(options.regularsPath ?? ':memory:');
    this.addHost(demoChannels.host);
    const demo = this.get('demo');
    const config = demo.settings();
    if (!options.settings.get('demo'))
      demo.configure({ ...config, mode: 'enforce', allow: ['pixelpilot'], block: ['storm'] });
  }

  get(hostId: string): Room {
    const room = this.all.get(hostId);
    if (!room) throw new Error('Channel not connected.');
    return room;
  }

  addHost(profile: ChannelProfile): void {
    this.profiles.set(profile.id, profile);
    if (this.all.has(profile.id)) return;
    const room = new Room({
      hostId: profile.id,
      config: this.options.config ?? defaultPolicy(),
      generator: this.options.generator,
      quiet: this.options.quiet,
      now: this.options.now,
      gateKind: this.options.gateKind,
      history: new HostHistory(profile.id, this.regulars, this.options.now ?? Date.now),
      onSettle: (result) => this.settle(result),
      onRetention: (matchId, count) => this.options.ledger.retention(matchId, count),
    });
    const saved = this.options.settings.get(profile.id);
    if (saved) room.configure(saved);
    this.all.set(profile.id, room);
    room.beginStream(this.session);
  }

  beginStream(hostId: string, streamId = this.session): void {
    this.get(hostId).beginStream(streamId);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.all.values()].map((room) => room.flush()));
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      try {
        await Promise.all([...this.all.values()].map((room) => room.close()));
      } finally {
        this.regulars.close();
      }
    })();
    return this.closing;
  }

  async demo(scenario: Scenario, speed = 1): Promise<Room> {
    const room = this.get('demo');
    room.speed = speed;
    const channels = structuredClone(demoChannels);
    if (scenario === 'stranger-raid')
      channels.raider = { ...channels.raider, id: this.newStranger(), name: 'NewChallenger' };
    if (scenario === 'hate-raid')
      channels.raider = { ...channels.raider, id: 'storm', name: 'UnwelcomeRaid' };
    const raiderLogin =
      scenario === 'normal' || scenario === 'collab'
        ? 'pixelpilot'
        : scenario === 'stranger-raid'
          ? channels.raider.id
          : 'storm';
    await this.raid('demo', {
      channels,
      raiderLogin,
      accountAgeDays: 300,
      hostFollowsRaider: false,
      viewers: 300,
      homeMembers: 20,
      simulated: true,
      ...(scenario === 'collab'
        ? {
            collab: {
              participants: [
                { id: 'demo', login: 'mossy' },
                { id: 'pixel', login: 'pixelpilot' },
              ],
              sessionParticipantIds: ['demo', 'pixel'],
            },
          }
        : {}),
    });
    return room;
  }

  /** Each ASK demo is a new fictional channel; friendly raids keep their stable identity. */
  private newStranger(): string {
    const { allow, block } = this.get('demo').settings();
    const listed = new Set([...allow, ...block].map((login) => login.toLowerCase()));
    let id: string;
    do {
      id = `wanderer${++this.strangerSequence}`;
    } while (listed.has(id) || this.options.ledger.pair('demo', id));
    return id;
  }

  async raid(hostId: string, request: RaidRequest): Promise<void> {
    const room = this.get(hostId);
    const pair = this.options.ledger.pair(hostId, request.channels.raider.id);
    const now = (this.options.now ?? Date.now)();
    const key = `${hostId}:${request.channels.raider.id}`;
    const raids = (this.raidHistory.get(key) ?? []).filter((time) => time > now - 3600000);
    raids.push(now);
    this.raidHistory.set(key, raids);
    room.setRematch(
      pair
        ? `REMATCH · ${pair.homeWins === pair.raiderWins ? 'TIED' : pair.homeWins > pair.raiderWins ? 'HOME LEADS' : 'RAIDERS LEAD'} ${pair.homeWins}–${pair.raiderWins}`
        : undefined,
    );
    const facts = room.settings().facts;
    await room.raid({
      ...request,
      hasPriorMatch: Boolean(pair),
      raidsLastHour: request.simulated ? 1 : raids.length,
      channels: {
        ...request.channels,
        host: {
          ...request.channels.host,
          facts: facts.length ? facts : request.channels.host.facts,
        },
      },
    });
  }

  save(hostId: string): void {
    this.options.settings.set(hostId, this.get(hostId).settings());
  }
  graph() {
    return this.options.ledger.graph();
  }

  step(dtMs: number): void {
    for (const room of this.all.values()) {
      try {
        room.step(dtMs * room.speed);
      } catch {
        /* A failed room never stops other streams. */
      }
    }
  }

  private settle(result: CompletedMatch): void {
    const versus = result.results.filter((round) => round.roundId !== 'fusion-boss');
    const home = versus.filter((round) => round.winner === 'home').length;
    const raiders = versus.filter((round) => round.winner === 'raiders').length;
    this.options.ledger.settle({
      matchId: result.matchId,
      hostId: result.hostId,
      raiderId: result.raiderId,
      hostName: result.hostName,
      raiderName: result.raiderName,
      winner: home === raiders ? 'none' : home > raiders ? 'home' : 'raiders',
      bossKilled: result.results.some(
        (round) => round.roundId === 'fusion-boss' && round.winner === 'both',
      ),
      endedAtMs: result.atMs,
      startDecisionId: result.startDecision.decisionId,
      settleDecisionId: result.settleDecision.decisionId,
      startDossierId: result.startDecision.dossierId,
      settleDossierId: result.settleDecision.dossierId,
      unsigned: result.startDecision.source === 'local' || result.settleDecision.source === 'local',
    });
  }
}
