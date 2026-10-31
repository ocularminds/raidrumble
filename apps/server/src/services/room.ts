import { randomUUID } from 'node:crypto';
import {
  createContext,
  type Assignment,
  type MatchView,
  type RoundResult,
} from '@raidrumble/engine';
import { ContentService, type Channels, type ContentGenerator } from '@raidrumble/content';
import {
  LocalPolicyGate,
  DecionisGate,
  PolicyExecutor,
  type Decision,
  type PolicyConfig,
} from '@raidrumble/policy';
import type { ArenaView, DashboardView } from '../model.js';
import { Game, type GameChat } from './game.js';
import { SpecialService } from './specials.js';
import { HostHistory } from './history.js';
import { MatchArchive } from './archive.js';
import { GlowHistory } from './glow.js';

export interface RaidRequest {
  channels: Channels;
  raiderLogin: string;
  accountAgeDays: number | null;
  hostFollowsRaider: boolean | null;
  viewers: number;
  homeMembers?: number;
  hasPriorMatch?: boolean;
  raidsLastHour?: number;
  simulated?: boolean;
  collab?: { participants: { id: string; login: string }[]; sessionParticipantIds: string[] };
  roster?: ReadonlySet<string>;
  chatterDelta?: ReadonlySet<string>;
  occurredAt?: number;
  onComplete?: () => void;
}

export interface RoomChat extends GameChat {
  occurredAt?: number;
}

export interface CompletedMatch {
  matchId: string;
  hostId: string;
  raiderId: string;
  results: readonly RoundResult[];
  startDecision: Decision;
  settleDecision: Decision;
  atMs: number;
  hostName: string;
  raiderName: string;
}

export interface RoomOptions {
  hostId: string;
  config: PolicyConfig;
  now?: () => number;
  generator?: ContentGenerator;
  quiet?: boolean;
  gateKind?: 'local' | 'decionis';
  history?: HostHistory;
  onSettle?: (result: CompletedMatch) => void | boolean | Promise<void | boolean>;
  onRetention?: (
    matchId: string,
    count: number,
    decision: Decision,
  ) => void | boolean | Promise<void | boolean>;
}

/** One authority, one active match and one host's ephemeral channel state. */
export class Room {
  readonly gate: LocalPolicyGate;
  readonly executor: PolicyExecutor;
  private readonly content: ContentService;
  private readonly clock: () => number;
  private readonly history: HostHistory;
  private readonly archive: MatchArchive;
  private readonly glows: GlowHistory;
  private game?: Game;
  private lastMatch?: MatchView;
  private request?: RaidRequest;
  private pending?: { decision: Decision; request: RaidRequest; expiresAt: number };
  private starting = false;
  private settled = false;
  private startDecision?: Decision;
  private lastDecision?: Decision;
  private names = new Map<string, string>();
  private labels = { hostName: 'Home Guard', raiderName: 'Raiders' };
  private readonly taggedRaiders = new Map<string, number>();
  private logicalNow = 0;
  private matchStartedAt = 0;
  private epoch = 0;
  private closed = false;
  private closing?: Promise<void>;
  private special?: SpecialService;
  private reducedMotion = false;
  private facts: string[] = [];
  private rematch?: string;
  speed = 1;

  constructor(private readonly options: RoomOptions) {
    this.clock = options.now ?? Date.now;
    const Gate = options.gateKind === 'decionis' ? DecionisGate : LocalPolicyGate;
    this.gate = new Gate(options.config, {
      now: this.clock,
      ...(options.quiet ? { logger: () => undefined } : {}),
    });
    this.executor = new PolicyExecutor(this.gate);
    this.content = new ContentService(this.gate, options.generator);
    this.history = options.history ?? new HostHistory(options.hostId, undefined, this.clock);
    this.archive = new MatchArchive(this.gate, this.executor, options);
    this.glows = new GlowHistory(this.archive);
  }

  async raid(request: RaidRequest): Promise<Decision> {
    if (this.closed) throw new Error('This channel has closed.');
    if (this.starting || this.pending || (this.game && this.game.view().status !== 'finished'))
      throw new Error('A match is already active.');
    this.starting = true;
    const epoch = ++this.epoch;
    request = {
      ...request,
      occurredAt: request.occurredAt ?? this.clock(),
      homeMembers:
        request.homeMembers ??
        (request.simulated
          ? 20
          : Math.max(5, this.history.recentCount(request.occurredAt ?? this.clock()))),
      roster: request.roster ? new Set(request.roster) : undefined,
      chatterDelta: request.chatterDelta ? new Set(request.chatterDelta) : undefined,
    };
    try {
      const decision = await this.gate.authorize({
        action: request.collab ? 'rumble.start.collab' : 'rumble.start',
        actor: request.collab
          ? { kind: 'host', twitchUserId: this.options.hostId }
          : { kind: 'system' },
        channel: { hostId: this.options.hostId, raiderId: request.channels.raider.id },
        payload: request.collab ?? {
          raiderLogin: request.raiderLogin,
          raiderAccountAgeDays: request.accountAgeDays,
          raidViewers: request.viewers,
          hostFollowsRaider: request.hostFollowsRaider,
          hasPriorMatch: request.hasPriorMatch ?? false,
          factsUnavailable: request.accountAgeDays === null || request.hostFollowsRaider === null,
          raidsLastHour: request.raidsLastHour ?? 1,
        },
      });
      if (epoch !== this.epoch) return decision;
      this.lastDecision = decision;
      if (
        decision.verdict === 'ESCALATE' &&
        (decision.mode === 'enforce' ||
          decision.reasonCodes.some((code) => code === 'POLICY_TIMEOUT' || code === 'POLICY_ERROR'))
      ) {
        this.pending = { decision, request, expiresAt: this.clock() + 10000 };
      } else {
        await this.executor.execute(decision, () => this.begin(request, decision, epoch));
      }
      return decision;
    } finally {
      if (epoch === this.epoch) this.starting = false;
    }
  }

  async approve(decisionId: string, actorId: string): Promise<boolean> {
    const pending = this.pending;
    if (
      !pending ||
      pending.decision.decisionId !== decisionId ||
      this.clock() >= pending.expiresAt ||
      this.starting
    )
      return false;
    this.starting = true;
    const epoch = this.epoch;
    try {
      const decision = await this.gate.approve(decisionId, actorId);
      if (epoch !== this.epoch) return false;
      this.pending = undefined;
      this.lastDecision = decision;
      const result = await this.executor.execute(decision, () =>
        this.begin(pending.request, decision, epoch),
      );
      return result.executed && result.value === true;
    } catch {
      return false;
    } finally {
      if (epoch === this.epoch) this.starting = false;
    }
  }

  decline(): void {
    if (this.pending) {
      this.epoch += 1;
      this.starting = false;
    }
    this.pending = undefined;
  }

  reset(): void {
    this.epoch += 1;
    this.starting = false;
    this.releaseRoster();
    this.pending = undefined;
    this.game = undefined;
    this.lastMatch = undefined;
    this.request = undefined;
    this.special = undefined;
    this.names.clear();
    this.taggedRaiders.clear();
    this.startDecision = undefined;
    this.settled = false;
  }

  step(dtMs: number): void {
    if (this.closed || !Number.isFinite(dtMs) || dtMs <= 0) return;
    this.logicalNow += dtMs;
    if (this.pending && this.clock() >= this.pending.expiresAt) this.pending = undefined;
    const game = this.game;
    if (game && game.view().status !== 'finished') {
      game.step(dtMs);
      if (game.view().status === 'finished' && !this.settled) {
        this.settled = true;
        this.complete(game);
      }
    }
    this.glows.step(this.logicalNow);
    if (!this.game && !this.glows.view()) {
      this.lastMatch = undefined;
      this.request = undefined;
    }
  }

  async chat(message: RoomChat): Promise<boolean> {
    if (this.closed) return false;
    const evidence = this.history.observe(message.userId, message.occurredAt);
    this.glows.observe(message.userId, this.logicalNow);
    const game = this.game;
    const request = this.request;
    if (game?.view().status === 'endcard' && game.assignment(message.userId)?.team === 'raiders') {
      this.taggedRaiders.set(message.userId, game.now());
    }
    if (!game || !request || game.view().status !== 'playing') return false;
    const epoch = this.epoch;
    let name = this.names.get(message.userId);
    if (!name) {
      name = await this.content.name(message.displayName ?? 'Viewer', this.options.hostId);
      if (this.game !== game || epoch !== this.epoch) return false;
      this.names.set(message.userId, name);
    }
    const counted = game.chat({
      ...message,
      displayName: name,
      firstHostMessageAtMs: evidence.firstAtMs - (request.occurredAt ?? this.clock()),
      isRegular: evidence.isRegular,
    });
    if (game.assignment(message.userId)?.team === 'raiders')
      this.taggedRaiders.set(message.userId, game.now());
    else this.taggedRaiders.delete(message.userId);
    return counted;
  }

  assignment(userId: string): Assignment | undefined {
    return this.game?.assignment(userId);
  }
  beginStream(streamId: string): void {
    this.history.beginStream(streamId);
  }
  flush(): Promise<void> {
    return this.archive.flush();
  }
  get persistenceFailures(): readonly string[] {
    return this.archive.failures;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.reset();
    this.glows.clear();
    this.history.clear();
    this.closing = this.flush();
    return this.closing;
  }

  async fire(actorId: string, special: 'ram' | 'oil'): Promise<boolean> {
    if (this.game?.view().round?.id !== 'siege' || this.game.view().status !== 'playing')
      return false;
    return Boolean(await this.special?.fire(actorId, special));
  }

  async reinforce(
    event: { userId: string; rewardId: string; status: string; redemptionId: string },
    rewardId: string,
  ): Promise<boolean> {
    if (this.game?.view().status !== 'playing') return false;
    return Boolean(await this.special?.reinforce(event, rewardId));
  }

  setRematch(banner?: string): void {
    this.rematch = banner;
  }
  get raiderId(): string | undefined {
    return this.request?.channels.raider.id;
  }
  get matchId(): string | undefined {
    return this.game?.view().matchId ?? this.lastMatch?.matchId;
  }
  get specialBudgets() {
    return this.special?.budgets;
  }

  settings(): DashboardView['settings'] {
    const config = this.gate.getConfig();
    return {
      ...config.lists,
      mode: config.actions['rumble.start'].mode ?? config.defaults.mode,
      reducedMotion: this.reducedMotion,
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
    this.facts = settings.facts.slice(0, 3).map((fact) => fact.slice(0, 160));
    this.names.clear();
  }

  view(): ArenaView {
    const match = this.game?.view() ?? this.lastMatch;
    const glow = this.glows.view();
    const decision = this.lastDecision && {
      ...this.lastDecision,
      action: this.gate.getRequest(this.lastDecision.decisionId)?.action ?? 'rumble.start',
    };
    return {
      hostId: this.options.hostId,
      ...this.labels,
      connected: true,
      reducedMotion: this.reducedMotion,
      simulated: this.request?.simulated ?? this.options.hostId === 'demo',
      status: this.pending
        ? 'pending'
        : !this.game && glow
          ? 'afterglow'
          : match
            ? 'active'
            : 'idle',
      match,
      decision,
      rematch: this.rematch,
      ...(this.pending
        ? {
            pending: {
              decisionId: this.pending.decision.decisionId,
              expiresAt: this.pending.expiresAt,
            },
          }
        : {}),
      ...(glow ? { afterglow: glow } : {}),
    };
  }

  private async begin(request: RaidRequest, decision: Decision, epoch: number): Promise<boolean> {
    if (this.closed || epoch !== this.epoch) return false;
    const content = await this.content.create(request.channels);
    if (this.closed || epoch !== this.epoch) return false;
    const [hostName, raiderName] = await Promise.all([
      this.content.name(request.channels.host.name, this.options.hostId, 'Home Guard'),
      this.content.name(request.channels.raider.name, this.options.hostId, 'Raiders'),
    ]);
    let safeNames = new Map<string, string>();
    if (request.simulated) {
      const names = await Promise.all(
        Array.from({ length: 35 }, async (_, index) => {
          const home = index < 20;
          const number = home ? index : index - 20;
          return [
            `${home ? 'home' : 'raider'}${number}`,
            await this.content.name(
              `${home ? 'Guardian' : 'Raider'} ${String(number + 1).padStart(2, '0')}`,
              this.options.hostId,
            ),
          ] as const;
        }),
      );
      safeNames = new Map(names);
    }
    if (this.closed || epoch !== this.epoch) return false;
    this.names = safeNames;
    const matchId = randomUUID();
    this.special = new SpecialService(this.gate, {
      hostId: this.options.hostId,
      raiderId: request.channels.raider.id,
      matchId,
      now: () => this.game?.now() ?? 0,
    });
    this.labels = { hostName, raiderName };
    this.request = request;
    this.lastMatch = undefined;
    this.taggedRaiders.clear();
    this.matchStartedAt = this.logicalNow;
    this.startDecision = decision;
    this.settled = false;
    this.game = new Game({
      hostId: this.options.hostId,
      raiderId: request.channels.raider.id,
      simulated: request.simulated,
      collab: Boolean(request.collab),
      names: this.names,
      roster: request.roster,
      chatterDelta: request.chatterDelta,
      modifiers: this.special,
      context: createContext({
        matchId,
        seed: 42,
        nowMs: 0,
        content,
        teams: { home: request.homeMembers ?? 5, raiders: request.viewers },
      }),
    });
    return true;
  }

  private complete(game: Game): void {
    if (!this.startDecision || !this.request) return;
    const view = game.view();
    const request = this.request;
    const startDecision = this.startDecision;
    const settled = this.archive.settle({
      matchId: view.matchId,
      hostId: this.options.hostId,
      raiderId: request.channels.raider.id,
      results: view.results,
      startDecision,
      atMs: this.clock(),
      ...this.labels,
    });
    const seen = new Map<string, number>();
    for (const [id, time] of [...game.raiderLastSeen, ...this.taggedRaiders]) {
      if (game.assignment(id)?.team === 'raiders') seen.set(id, this.matchStartedAt + time);
    }
    this.glows.add(
      {
        matchId: view.matchId,
        hostId: this.options.hostId,
        raiderId: request.channels.raider.id,
        startDecisionId: startDecision.decisionId,
      },
      this.matchStartedAt + view.elapsedMs,
      seen,
      new Set(seen.keys()),
      Boolean(request.simulated),
      settled,
    );
    this.releaseRoster();
    this.lastMatch = view;
    this.game = undefined;
    this.special = undefined;
    this.names.clear();
    this.taggedRaiders.clear();
  }

  private releaseRoster(): void {
    const request = this.request;
    if (!request) return;
    this.request = {
      ...request,
      roster: undefined,
      chatterDelta: undefined,
      onComplete: undefined,
    };
    try {
      request.onComplete?.();
    } catch {
      /* Capture cleanup never interrupts the match clock. */
    }
  }
}
