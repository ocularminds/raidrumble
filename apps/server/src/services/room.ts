import { randomUUID } from 'node:crypto';
import { createContext, type Assignment, type MatchView } from '@raidrumble/engine';
import {
  LocalPolicyGate,
  DecionisGate,
  PolicyExecutor,
  actionBudget,
  approvalTimeout,
  type ConfigurablePolicyGate,
  type Decision,
} from '@raidrumble/policy';
import type { ArenaView, DashboardView } from '../model.js';
import { Game } from './game.js';
import { SpecialService } from './specials.js';
import { HostHistory } from './history.js';
import { MatchArchive } from './archive.js';
import { GlowHistory } from './glow.js';
import type {
  PendingRaid,
  PreparedMatch,
  RaidRequest,
  RoomChat,
  RoomOptions,
} from '../models/room.js';
import { arenaView } from '../models/arena.js';
import { raidAction, raidLogin } from '../models/room.js';
import { RoomContent } from './content.js';
import { HostPreferences } from './preferences.js';
export type { CompletedMatch, RaidRequest, RoomChat, RoomOptions } from '../models/room.js';

/** One authority, one active match and one host's ephemeral channel state. */
export class Room {
  readonly gate: ConfigurablePolicyGate;
  readonly executor: PolicyExecutor;
  private readonly content: RoomContent;
  private readonly clock: () => number;
  private readonly history: HostHistory;
  private readonly archive: MatchArchive;
  private readonly glows: GlowHistory;
  private readonly preferences: HostPreferences;
  private game?: Game;
  private lastMatch?: MatchView;
  private request?: RaidRequest;
  private pending?: PendingRaid;
  private incoming?: { request: RaidRequest; expiresAt: number };
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
  private hostLabelVersion = 0;
  private rematch?: string;
  speed = 1;

  constructor(private readonly options: RoomOptions) {
    this.clock = options.now ?? Date.now;
    const Gate = options.gateKind === 'decionis' ? DecionisGate : LocalPolicyGate;
    this.gate = new Gate(options.config, {
      ...options.decionis,
      now: this.clock,
      ...(options.quiet ? { logger: () => undefined } : {}),
    });
    this.executor = new PolicyExecutor(this.gate);
    this.content = new RoomContent(this.gate, options.hostId, options.generator);
    this.history = options.history ?? new HostHistory(options.hostId, undefined, this.clock);
    this.archive = new MatchArchive(this.gate, this.executor, options);
    this.glows = new GlowHistory(this.archive);
    this.preferences = new HostPreferences(this.gate);
  }

  async raid(request: RaidRequest): Promise<Decision> {
    if (this.closed) throw new Error('This channel has closed.');
    if (this.starting || this.pending || (this.game && this.game.view().status !== 'finished'))
      throw new Error('A match is already active.');
    this.starting = true;
    const epoch = ++this.epoch;
    const action = request.collab ? 'rumble.start.collab' : 'rumble.start';
    const config = this.gate.getConfig();
    const approvalDeadline = this.clock() + approvalTimeout(config, action);
    request = {
      ...request,
      channels: structuredClone(request.channels),
      collab: request.collab ? structuredClone(request.collab) : undefined,
      occurredAt: request.occurredAt ?? this.clock(),
      homeMembers:
        request.homeMembers ??
        (request.simulated
          ? 20
          : Math.max(5, this.history.recentCount(request.occurredAt ?? this.clock()))),
      roster: request.roster ? new Set(request.roster) : undefined,
      chatterDelta: request.chatterDelta ? new Set(request.chatterDelta) : undefined,
    };
    this.labels = { ...this.labels, raiderName: 'Raiders' };
    this.incoming = {
      request,
      expiresAt:
        this.clock() + Math.min(actionBudget(config, action), approvalTimeout(config, action)),
    };
    const labels = this.preview(request, epoch);
    try {
      const authorization = this.gate.authorize(raidAction(request, this.options.hostId));
      const preparation = this.content.stage(request);
      const decision = await authorization;
      await labels;
      if (epoch !== this.epoch) return decision;
      this.lastDecision = decision;
      if (
        decision.verdict === 'ESCALATE' &&
        (decision.mode === 'enforce' ||
          decision.reasonCodes.some((code) => code === 'POLICY_TIMEOUT' || code === 'POLICY_ERROR'))
      ) {
        const expiresAt = this.gate
          .listRecords()
          .find((record) => record.decisionId === decision.decisionId)?.expiresAt;
        this.pending = {
          decision,
          request,
          expiresAt: Math.min(approvalDeadline, expiresAt ?? approvalDeadline),
          preparation: preparation.ready,
        };
      } else if (decision.verdict === 'ALLOW' || decision.mode === 'shadow') {
        const prepared =
          decision.source === 'decionis' && decision.grant
            ? preparation.current()
            : await preparation.ready;
        if (epoch !== this.epoch) return decision;
        await this.executor.execute(decision, () =>
          this.begin(
            request,
            decision,
            epoch,
            Math.min(approvalDeadline, decision.grant?.expiresAt ?? Infinity),
            prepared,
          ),
        );
      }
      return decision;
    } finally {
      if (epoch === this.epoch) {
        this.starting = false;
        this.incoming = undefined;
      }
    }
  }

  async approve(decisionId: string, actorId: string, trustNextTime = false): Promise<boolean> {
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
      const prepared = await pending.preparation;
      if (epoch !== this.epoch || this.pending !== pending || this.clock() >= pending.expiresAt)
        return false;
      const decision = await this.gate.approve(decisionId, actorId);
      if (epoch !== this.epoch || this.pending !== pending || this.clock() >= pending.expiresAt)
        return false;
      this.lastDecision = decision;
      if (decision.verdict === 'ESCALATE') {
        this.pending = { ...pending, decision };
        return false;
      }
      this.pending = undefined;
      const result = await this.executor.execute(decision, () =>
        this.begin(
          pending.request,
          decision,
          epoch,
          Math.min(pending.expiresAt, decision.grant?.expiresAt ?? Infinity),
          prepared,
        ),
      );
      const accepted =
        result.executed &&
        result.value === true &&
        epoch === this.epoch &&
        this.startDecision?.decisionId === decision.decisionId;
      if (accepted && trustNextTime && actorId === this.options.hostId) this.trust(pending.request);
      return accepted;
    } catch {
      return false;
    } finally {
      if (epoch === this.epoch) this.starting = false;
    }
  }

  decline(): void {
    if (this.pending || this.incoming || this.starting) {
      this.epoch += 1;
      this.starting = false;
    }
    this.pending = undefined;
    this.incoming = undefined;
  }

  reset(): void {
    this.epoch += 1;
    this.starting = false;
    this.incoming = undefined;
    if (this.request?.practice === 'realchat') this.glows.clear();
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
      name = await this.content.name(message.displayName ?? 'Viewer');
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
  async nameHost(value: string): Promise<void> {
    const version = ++this.hostLabelVersion;
    const hostName = await this.content.name(value, 'Home Guard');
    if (!this.closed && version === this.hostLabelVersion)
      this.labels = { ...this.labels, hostName };
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
    return this.preferences.read();
  }

  configure(settings: DashboardView['settings']): void {
    this.preferences.configure(settings);
    this.names.clear();
  }

  approval(): DashboardView['approval'] {
    const pending = this.pending;
    if (!pending || pending.expiresAt <= this.clock()) return undefined;
    return {
      source: pending.decision.source,
      expiresAt: Math.min(pending.expiresAt, pending.decision.approval?.expiresAt ?? Infinity),
      ...(pending.decision.approval ? { url: pending.decision.approval.url } : {}),
    };
  }

  view(): ArenaView {
    return arenaView({
      hostId: this.options.hostId,
      now: this.clock(),
      labels: this.labels,
      settings: this.preferences.read(),
      request: this.request,
      pending: this.pending,
      incoming: this.incoming,
      decision: this.lastDecision,
      action: this.lastDecision
        ? (this.gate.getRequest(this.lastDecision.decisionId)?.action ?? 'rumble.start')
        : 'rumble.start',
      match: this.game?.view() ?? this.lastMatch,
      hasGame: Boolean(this.game),
      glow: this.glows.view(),
      rematch: this.rematch,
    });
  }

  private async preview(request: RaidRequest, epoch: number): Promise<void> {
    const version = ++this.hostLabelVersion;
    const labels = await this.content.labels(request.channels);
    if (!this.closed && epoch === this.epoch)
      this.labels = {
        ...labels,
        hostName: version === this.hostLabelVersion ? labels.hostName : this.labels.hostName,
      };
  }

  private trust(request: RaidRequest): void {
    const login = raidLogin(request);
    if (login && !request.practice) this.preferences.trust(login);
  }

  private begin(
    request: RaidRequest,
    decision: Decision,
    epoch: number,
    deadline: number,
    prepared: PreparedMatch,
  ): boolean {
    if (this.closed || epoch !== this.epoch || this.clock() >= deadline) return false;
    const { content, names } = prepared;
    this.names = names;
    const matchId = randomUUID();
    this.special = new SpecialService(this.gate, {
      hostId: this.options.hostId,
      raiderId: request.channels.raider.id,
      matchId,
      now: () => this.game?.now() ?? 0,
    });
    this.request = request;
    this.lastMatch = undefined;
    this.taggedRaiders.clear();
    this.matchStartedAt = this.logicalNow;
    this.startDecision = decision;
    this.settled = false;
    this.game = new Game({
      hostId: this.options.hostId,
      raiderId: request.channels.raider.id,
      simulated: request.simulated && request.practice !== 'realchat',
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
    this.incoming = undefined;
    return true;
  }

  private complete(game: Game): void {
    if (!this.startDecision || !this.request) return;
    const view = game.view();
    const request = this.request;
    const startDecision = this.startDecision;
    const practice = request.practice === 'realchat';
    const settled = practice
      ? Promise.resolve(false)
      : this.archive.settle({
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
      Boolean(request.simulated) && !practice,
      settled,
      !practice,
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
