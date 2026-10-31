import type { Decision, HelixWrite } from '@raidrumble/policy';
import { HelixReader, TwitchWrites } from '@raidrumble/twitch';
import type { LiveService, WarlordLink } from '../live/index.js';
import type { Room } from './room.js';
import type { Rooms } from './rooms.js';

export type StreamLive = Pick<
  LiveService,
  | 'botUserId'
  | 'profile'
  | 'authorizeHost'
  | 'authorizeWarlord'
  | 'userId'
  | 'credentials'
  | 'warlordLink'
  | 'warlord'
  | 'clearMatch'
  | 'clearRoster'
  | 'roster'
>;

interface LiveRun {
  matchId: string;
  raiderId: string;
  link: WarlordLink;
  ended: boolean;
}

interface RewardRequest {
  decision: Decision;
  write: HelixWrite;
  expiresAt: number;
}

export class StreamError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** One-shot stream effects and server-held setup proposals; never accepts actor IDs from UI. */
export class StreamActions {
  private readonly runs = new Map<string, LiveRun>();
  private readonly chatSent = new Map<string, number>();
  private readonly shoutoutSent = new Map<string, number>();
  private readonly rewards = new Map<string, RewardRequest>();
  private readonly rewardBusy = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly rooms: Rooms,
    private readonly live: StreamLive,
    private readonly options: {
      now?: () => number;
      onError?: (hostId: string, message: string) => void;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  async step(): Promise<void> {
    const work: Promise<void>[] = [];
    for (const [hostId, room] of this.rooms.all) {
      const view = room.view();
      const previous = this.runs.get(hostId);
      if (previous && (previous.matchId !== view.match?.matchId || view.simulated)) {
        this.live.clearMatch(previous.matchId);
        this.runs.delete(hostId);
      }
      if (hostId === 'demo' || view.simulated || !view.match || !room.raiderId) continue;
      let run = this.runs.get(hostId);
      if (!run) {
        run = {
          matchId: view.match.matchId,
          raiderId: room.raiderId,
          link: this.live.warlordLink(hostId, room.raiderId, view.match.matchId),
          ended: false,
        };
        this.runs.set(hostId, run);
        if (view.match.status === 'playing' && view.match.round?.id === 'siege')
          work.push(this.announce(hostId, room, run));
      }
      if (view.match.status === 'finished' && !run.ended) {
        run.ended = true;
        this.live.clearMatch(run.matchId);
        this.live.clearRoster(run.raiderId);
        work.push(this.shoutout(hostId, room, run));
      }
    }
    for (const [pair, time] of this.shoutoutSent)
      if (this.now() - time > 3_600_000) this.shoutoutSent.delete(pair);
    await Promise.allSettled(work);
  }

  controller(token: string) {
    if (token === 'demo') {
      const room = this.rooms.all.get('demo');
      return room?.view().simulated
        ? { room, actorId: room.raiderId ?? '', simulated: true, loginUrl: '' }
        : undefined;
    }
    const target = this.live.warlord(token);
    if (!target) return undefined;
    const room = this.rooms.all.get(target.hostId);
    if (
      !room ||
      room.matchId !== target.matchId ||
      room.raiderId !== target.raiderId ||
      room.view().simulated ||
      room.view().match?.status === 'finished'
    )
      return undefined;
    const link = this.runs.get(target.hostId)?.link;
    return {
      room,
      actorId: target.raiderId,
      simulated: false,
      loginUrl: link?.token === token ? link.loginUrl : '',
    };
  }

  rewardStatus(hostId: string) {
    return {
      eligible: Boolean(this.live.profile(hostId)?.affiliate),
      configured: this.rooms.rewardIds.has(hostId),
      reward: {
        title: 'Reinforcements',
        cost: 100,
        prompt: 'During Siege: +1 input weight for 10 seconds. Once per match.',
        skipQueue: true,
      },
    };
  }

  async prepareReward(hostId: string) {
    if (this.rewardBusy.has(hostId))
      throw new StreamError(409, 'Reward setup is already in progress.');
    this.rewardBusy.add(hostId);
    try {
      return await this.prepare(hostId);
    } finally {
      this.rewardBusy.delete(hostId);
    }
  }

  private async prepare(hostId: string) {
    const status = this.rewardStatus(hostId);
    if (hostId === 'demo' || !status.eligible)
      throw new StreamError(
        403,
        'Channel Points require a connected Affiliate or Partner channel.',
      );
    const existing = this.rewards.get(hostId);
    if (existing && existing.expiresAt > this.now())
      return { ...status, decision: existing.decision, expiresAt: existing.expiresAt };
    const room = this.rooms.get(hostId);
    const write = TwitchWrites.reward(
      hostId,
      status.reward.title,
      status.reward.cost,
      this.rooms.rewardIds.get(hostId),
    );
    write.body = {
      ...write.body,
      prompt: status.reward.prompt,
      should_redemptions_skip_request_queue: true,
      is_max_per_user_per_stream_enabled: false,
    };
    delete write.body.max_per_user_per_stream;
    const decision = await room.gate.authorize({
      action: 'rewards.configure',
      actor: { kind: 'host', twitchUserId: hostId },
      channel: { hostId },
      payload: { write },
    });
    if (decision.verdict === 'BLOCK' || failed(decision))
      throw new StreamError(409, 'Reward setup was blocked by policy.');
    const config = room.gate.getConfig();
    const expiresAt =
      this.now() +
      (config.actions['rewards.configure'].otherwise.timeoutMs ?? config.params.escalateTimeoutMs);
    this.rewards.set(hostId, { decision, write: structuredClone(write), expiresAt });
    return { ...status, decision, expiresAt };
  }

  async approveReward(hostId: string, actorId: string, decisionId: string) {
    if (this.rewardBusy.has(hostId))
      throw new StreamError(409, 'Reward setup is already in progress.');
    this.rewardBusy.add(hostId);
    try {
      return await this.configureReward(hostId, actorId, decisionId);
    } finally {
      this.rewardBusy.delete(hostId);
    }
  }

  private async configureReward(hostId: string, actorId: string, decisionId: string) {
    const pending = this.rewards.get(hostId);
    if (
      actorId !== hostId ||
      !pending ||
      pending.decision.decisionId !== decisionId ||
      pending.expiresAt <= this.now()
    )
      throw new StreamError(409, 'This reward approval expired or was already used.');
    this.rewards.delete(hostId);
    if (!this.live.profile(hostId)?.affiliate)
      throw new StreamError(403, 'Channel Points eligibility is no longer available.');
    const credentials = await this.live.credentials(hostId, 'host');
    if (!credentials) throw new StreamError(401, 'Reconnect the host to configure Channel Points.');
    const room = this.rooms.get(hostId);
    let decision: Decision;
    try {
      decision =
        pending.decision.verdict === 'ESCALATE'
          ? await room.gate.approve(decisionId, actorId)
          : pending.decision;
    } catch {
      throw new StreamError(409, 'This reward approval expired or was already used.');
    }
    const result = await room.executor.executeHelix(decision, pending.write, credentials);
    if (!result.executed) throw new StreamError(502, 'Twitch could not configure this reward.');
    const rewardId =
      idFrom(result.value) ??
      (pending.write.method === 'PATCH' ? this.rooms.rewardIds.get(hostId) : undefined);
    if (!rewardId) throw new StreamError(502, 'Twitch did not return the configured reward ID.');
    this.rooms.rewardIds.set(hostId, rewardId);
    return { configured: true, rewardId };
  }

  async collab(hostId: string, requestedPeer?: string) {
    const participants = [...new Set(this.rooms.shared.get(hostId) ?? [])];
    const peers = participants.filter((id) => id !== hostId);
    if (!participants.includes(hostId) || !peers.length)
      throw new StreamError(409, 'Start a Shared Chat session before starting Collab Rumble.');
    const peerId = requestedPeer ?? (peers.length === 1 ? peers[0] : undefined);
    if (!peerId || !peers.includes(peerId) || participants.length > 100)
      throw new StreamError(400, 'Choose one of the current Shared Chat participants.');
    const credentials = await this.live.credentials(hostId, 'host');
    if (!credentials) throw new StreamError(401, 'Reconnect the host before starting a collab.');
    const helix = new HelixReader({
      clientId: credentials.clientId,
      accessToken: () => credentials.accessToken,
      ...(credentials.fetch ? { fetch: credentials.fetch } : {}),
    });
    const [users, channels, homeChat, raidChat] = await Promise.allSettled([
      helix.users(participants),
      helix.channels([hostId, peerId]),
      helix.chatters(hostId, hostId),
      helix.chatters(peerId, hostId),
    ]);
    if (
      users.status !== 'fulfilled' ||
      participants.some((id) => !users.value.some((user) => user.id === id))
    )
      throw new StreamError(503, 'Unable to verify Shared Chat identities. Try again.');
    const current = [...new Set(this.rooms.shared.get(hostId) ?? [])];
    if (current.length !== participants.length || !current.every((id) => participants.includes(id)))
      throw new StreamError(409, 'The Shared Chat session changed. Try again.');
    const peer = users.value.find((user) => user.id === peerId)!;
    const host = this.rooms.profiles.get(hostId);
    if (!host) throw new StreamError(409, 'The host channel is not connected.');
    const channel =
      channels.status === 'fulfilled'
        ? channels.value.find((item) => item.broadcaster_id === peerId)
        : undefined;
    const hostChannel =
      channels.status === 'fulfilled'
        ? channels.value.find((item) => item.broadcaster_id === hostId)
        : undefined;
    const currentHost = hostChannel
      ? {
          ...host,
          name: hostChannel.broadcaster_name,
          category: hostChannel.game_name,
          title: hostChannel.title,
          tags: hostChannel.tags,
        }
      : host;
    try {
      await this.rooms.raid(hostId, {
        channels: {
          host: currentHost,
          raider: {
            id: peerId,
            name: peer.display_name,
            category: channel?.game_name ?? '',
            title: channel?.title ?? '',
            tags: channel?.tags ?? [],
            facts: this.rooms.profiles.get(peerId)?.facts ?? [],
          },
        },
        raiderLogin: peer.login,
        accountAgeDays: null,
        hostFollowsRaider: null,
        viewers: Math.max(
          5,
          raidChat.status === 'fulfilled'
            ? (raidChat.value.total ?? raidChat.value.data.length)
            : this.live.roster(peerId).length,
        ),
        homeMembers: Math.max(
          5,
          homeChat.status === 'fulfilled'
            ? (homeChat.value.total ?? homeChat.value.data.length)
            : 5,
        ),
        collab: {
          participants: users.value.map((user) => ({ id: user.id, login: user.login })),
          sessionParticipantIds: participants,
        },
        roster: new Set(this.live.roster(peerId)),
      });
    } catch {
      throw new StreamError(409, 'A rumble is already active or this collab could not start.');
    }
    return this.rooms.get(hostId).view();
  }

  private async announce(hostId: string, room: Room, run: LiveRun): Promise<void> {
    try {
      const credentials = await this.live.credentials(hostId, 'bot');
      const botId = this.live.botUserId;
      if (
        !credentials ||
        !botId ||
        room.matchId !== run.matchId ||
        room.view().match?.status !== 'playing'
      )
        return;
      const text = `RaidRumble is on! Follow the overlay keyword. Warlord, your Battering Ram is ready: ${run.link.url}`;
      const lastSentAt = this.chatSent.get(hostId);
      const decision = await room.gate.authorize({
        action: 'chat.send',
        actor: { kind: 'system', twitchUserId: botId },
        channel: { hostId, raiderId: run.raiderId },
        matchId: run.matchId,
        payload: { text, templated: true, lastSentAt },
      });
      if (
        text.length > 500 ||
        failed(decision) ||
        (lastSentAt !== undefined && this.now() - lastSentAt < 5000)
      )
        return;
      if (room.matchId !== run.matchId || run.ended) return;
      this.chatSent.set(hostId, this.now());
      const result = await room.executor.executeHelix(
        decision,
        TwitchWrites.chat(hostId, botId, text),
        credentials,
      );
      if (!result.executed) this.report(hostId, 'The Warlord chat link could not be posted.');
    } catch {
      this.report(hostId, 'The Warlord chat link could not be posted.');
    }
  }

  private async shoutout(hostId: string, room: Room, run: LiveRun): Promise<void> {
    try {
      const credentials = await this.live.credentials(hostId, 'host');
      if (!credentials) return;
      const pair = `${hostId}:${run.raiderId}`;
      const lastSentAt = this.shoutoutSent.get(pair);
      const decision = await room.gate.authorize({
        action: 'shoutout.send',
        actor: { kind: 'host', twitchUserId: hostId },
        channel: { hostId, raiderId: run.raiderId },
        matchId: run.matchId,
        payload: { lastSentAt },
      });
      if (failed(decision) || (lastSentAt !== undefined && this.now() - lastSentAt < 3_600_000))
        return;
      this.shoutoutSent.set(pair, this.now());
      const result = await room.executor.executeHelix(
        decision,
        TwitchWrites.shoutout(hostId, run.raiderId, hostId),
        credentials,
      );
      if (!result.executed) this.report(hostId, 'The end-of-match shoutout could not be sent.');
    } catch {
      this.report(hostId, 'The end-of-match shoutout could not be sent.');
    }
  }

  private report(hostId: string, message: string): void {
    try {
      this.options.onError?.(hostId, message);
    } catch {
      /* Optional diagnostics never stop matches. */
    }
  }
}

function failed(decision: Decision): boolean {
  return decision.reasonCodes.some(
    (reason) => reason === 'POLICY_TIMEOUT' || reason === 'POLICY_ERROR',
  );
}

function idFrom(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data))
    return undefined;
  const first: unknown = value.data[0];
  return first &&
    typeof first === 'object' &&
    'id' in first &&
    typeof first.id === 'string' &&
    first.id
    ? first.id
    : undefined;
}
