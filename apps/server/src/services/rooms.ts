import { defaultPolicy, type DecionisOptions, type PolicyConfig } from '@raidrumble/policy';
import { demoChannels, type ChannelProfile, type ContentGenerator } from '@raidrumble/content';
import { randomUUID } from 'node:crypto';
import { Ledger, RegularStore } from '@raidrumble/ledger';
import type { Scenario } from '../model.js';
import { Room, type CompletedMatch, type RaidRequest, type RoomChat } from './room.js';
import { SettingsStore } from './settings.js';
import { HostHistory } from './history.js';

export interface RoomsOptions {
  ledger: Ledger;
  settings: SettingsStore;
  config?: PolicyConfig;
  generator?: ContentGenerator;
  ephemeralDemo?: boolean;
  quiet?: boolean;
  now?: () => number;
  regulars?: RegularStore;
  regularsPath?: string;
  gateKind?: 'local' | 'decionis';
  decionis?: DecionisOptions;
}

export class Rooms {
  readonly all = new Map<string, Room>();
  readonly profiles = new Map<string, ChannelProfile>();
  readonly shared = new Map<string, readonly string[]>();
  readonly rewardIds = new Map<string, string>();
  private readonly raidHistory = new Map<string, number[]>();
  private readonly regulars: RegularStore;
  private readonly practices = new Map<string, Room>();
  private readonly readyPractices = new Set<string>();
  private readonly incomingRaids = new Map<string, number>();
  /** Until Twitch supplies a stream id, a server session is the explicit history boundary. */
  private readonly session = `server:${randomUUID()}`;
  private strangerSequence = 0;
  private closing?: Promise<void>;

  constructor(private readonly options: RoomsOptions) {
    this.regulars = options.regulars ?? new RegularStore(options.regularsPath ?? ':memory:');
    this.addHost(demoChannels.host);
    const demo = this.get('demo');
    const config = demo.settings();
    if (options.ephemeralDemo || !options.settings.get('demo'))
      demo.configure({ ...config, mode: 'enforce', allow: ['pixelpilot'], block: ['storm'] });
  }

  get(hostId: string): Room {
    return this.practices.get(hostId) ?? this.primary(hostId);
  }

  /** Settings, hosted authority, and Twitch writes always use the retained primary room. */
  primary(hostId: string): Room {
    const room = this.all.get(hostId);
    if (!room) throw new Error('Channel not connected.');
    return room;
  }

  /** Selected overlay rooms; all remains the primary-only registry for side-effect services. */
  active(): readonly Room[] {
    return [...this.all.keys()].map((hostId) => this.get(hostId));
  }

  async chat(hostId: string, message: RoomChat): Promise<boolean> {
    const primary = this.primary(hostId);
    const selected = this.get(hostId);
    const counted = await primary.chat(message);
    return selected === primary ? counted : selected.chat(message);
  }

  addHost(profile: ChannelProfile): void {
    this.profiles.set(profile.id, profile);
    if (this.all.has(profile.id)) return;
    const ephemeral = profile.id === 'demo' && this.options.ephemeralDemo;
    const room = new Room({
      hostId: profile.id,
      config: this.options.config ?? defaultPolicy(),
      generator: profile.id === 'demo' ? undefined : this.options.generator,
      quiet: this.options.quiet,
      now: this.options.now,
      gateKind: profile.id === 'demo' ? 'local' : this.options.gateKind,
      decionis: profile.id === 'demo' ? undefined : this.options.decionis,
      history: ephemeral
        ? undefined
        : new HostHistory(profile.id, this.regulars, this.options.now ?? Date.now),
      onSettle: ephemeral ? undefined : (result) => this.settle(result),
      onRetention: ephemeral
        ? undefined
        : (matchId, count, decision) =>
            this.options.ledger.retention(matchId, count, decision.source === 'local'),
    });
    const saved = ephemeral ? undefined : this.options.settings.get(profile.id);
    if (saved) room.configure(saved);
    this.all.set(profile.id, room);
    room.beginStream(this.session);
    void room.nameHost(profile.name);
  }

  beginStream(hostId: string, streamId = this.session): void {
    this.primary(hostId).beginStream(streamId);
  }

  async flush(): Promise<void> {
    await Promise.all(
      [...this.all.values(), ...this.practices.values()].map((room) => room.flush()),
    );
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      try {
        await Promise.all(
          [...this.all.values(), ...this.practices.values()].map((room) => room.close()),
        );
      } finally {
        this.practices.clear();
        this.readyPractices.clear();
        this.regulars.close();
      }
    })();
    return this.closing;
  }

  /** Local, ephemeral overlay test. The fictional team never becomes a live channel or ledger edge. */
  async practice(hostId: string): Promise<Room> {
    if (hostId === 'demo') throw new Error('Choose a connected Twitch host for real chat.');
    if (this.closing) throw new Error('The server has closed.');
    const primary = this.primary(hostId);
    const view = primary.view();
    if (
      this.practices.has(hostId) ||
      this.incomingRaids.has(hostId) ||
      view.status === 'incoming' ||
      view.pending ||
      (view.match && view.match.status !== 'finished')
    )
      throw new Error('A match is already active.');
    const profile = this.profiles.get(hostId);
    if (!profile) throw new Error('Channel not connected.');
    const config = structuredClone(primary.gate.getConfig());
    const raiderId = `practice${hostId}`;
    const room = new Room({
      hostId,
      config,
      gateKind: 'local',
      quiet: this.options.quiet,
      now: this.options.now,
    });
    room.configure({
      ...primary.settings(),
      mode: 'enforce',
      allow: [...primary.settings().allow, raiderId],
    });
    room.beginStream(`practice:${this.session}`);
    this.practices.set(hostId, room);
    void room.nameHost(profile.name);
    try {
      await room.raid({
        channels: {
          host: profile,
          raider: {
            id: raiderId,
            name: 'Practice Raiders',
            category: 'Community Game',
            title: 'Test Raid with Real Chat',
            tags: [],
            facts: [
              'This is a fictional practice team for viewers in this chat.',
              'Choose a team before your first counted move.',
            ],
          },
        },
        raiderLogin: raiderId,
        accountAgeDays: Math.max(7, config.params.minRaiderAccountAgeDays),
        hostFollowsRaider: false,
        viewers: Math.max(5, config.params.minRaidSize),
        homeMembers: 5,
        simulated: true,
        practice: 'realchat',
      });
      if (this.practices.get(hostId) !== room || this.closing)
        throw new Error('This practice was cancelled.');
      this.readyPractices.add(hostId);
      return room;
    } catch (error) {
      if (this.practices.get(hostId) === room) {
        this.practices.delete(hostId);
        this.readyPractices.delete(hostId);
      }
      await room.close();
      throw error;
    }
  }

  async endPractice(hostId: string): Promise<void> {
    const room = this.practices.get(hostId);
    this.practices.delete(hostId);
    this.readyPractices.delete(hostId);
    await room?.close();
  }

  async demo(scenario: Scenario, speed = 1): Promise<Room> {
    const room = this.get('demo');
    room.speed = speed;
    const channels = structuredClone(demoChannels);
    if (scenario === 'stranger-raid')
      channels.raider = { ...channels.raider, id: this.newStranger(), name: 'NewChallenger' };
    if (scenario === 'hate-raid')
      channels.raider = { ...channels.raider, id: this.newStranger(), name: 'NewAccount' };
    const raiderLogin =
      scenario === 'normal' || scenario === 'collab' ? 'pixelpilot' : channels.raider.id;
    await this.raid('demo', {
      channels,
      raiderLogin,
      accountAgeDays: scenario === 'hate-raid' ? 2 : 300,
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
    this.incomingRaids.set(hostId, (this.incomingRaids.get(hostId) ?? 0) + 1);
    try {
      await this.endPractice(hostId);
      await this.startRaid(hostId, request);
    } finally {
      const remaining = (this.incomingRaids.get(hostId) ?? 1) - 1;
      if (remaining > 0) this.incomingRaids.set(hostId, remaining);
      else this.incomingRaids.delete(hostId);
    }
  }

  private async startRaid(hostId: string, request: RaidRequest): Promise<void> {
    const room = this.primary(hostId);
    const pair =
      hostId === 'demo' && this.options.ephemeralDemo
        ? undefined
        : this.options.ledger.pair(hostId, request.channels.raider.id);
    const now = (this.options.now ?? Date.now)();
    const key = `${hostId}:${request.channels.raider.id}`;
    const raids = (this.raidHistory.get(key) ?? []).filter((time) => time > now - 3600000);
    raids.push(now);
    if (!request.simulated) this.raidHistory.set(key, raids);
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
    if (hostId === 'demo' && this.options.ephemeralDemo) return;
    const settings = this.primary(hostId).settings();
    this.options.settings.set(hostId, settings);
    this.practices.get(hostId)?.configure(settings);
  }
  graph() {
    return this.options.ledger.graph();
  }

  step(dtMs: number): void {
    for (const room of [...this.all.values(), ...this.practices.values()]) {
      try {
        room.step(dtMs * room.speed);
      } catch {
        /* A failed room never stops other streams. */
      }
    }
    for (const [hostId, room] of this.practices) {
      const view = room.view();
      if (this.readyPractices.has(hostId) && view.status === 'idle' && !view.match)
        void this.endPractice(hostId);
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
