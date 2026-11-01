import type { ContentGenerator, Channels } from '@raidrumble/content';
import type { ContentPack, RoundResult } from '@raidrumble/engine';
import type { ActionRequest, Decision, DecionisOptions, PolicyConfig } from '@raidrumble/policy';
import type { GameChat } from '../services/game.js';
import type { HostHistory } from '../services/history.js';

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
  practice?: 'realchat';
  collab?: { participants: { id: string; login: string }[]; sessionParticipantIds: string[] };
  roster?: ReadonlySet<string>;
  chatterDelta?: ReadonlySet<string>;
  occurredAt?: number;
  onComplete?: () => void;
}

export function raidLogin(request: RaidRequest): string | undefined {
  const login = request.raiderLogin.trim().toLowerCase();
  return !request.collab && /^[a-z0-9_]{1,25}$/.test(login) ? login : undefined;
}

export function raidAction(request: RaidRequest, hostId: string): ActionRequest {
  return {
    action: request.collab ? 'rumble.start.collab' : 'rumble.start',
    actor: request.collab ? { kind: 'host', twitchUserId: hostId } : { kind: 'system' },
    channel: { hostId, raiderId: request.channels.raider.id },
    payload: request.collab ?? {
      raiderLogin: request.raiderLogin,
      raiderAccountAgeDays: request.accountAgeDays,
      raidViewers: request.viewers,
      hostFollowsRaider: request.hostFollowsRaider,
      hasPriorMatch: request.hasPriorMatch ?? false,
      factsUnavailable: request.accountAgeDays === null || request.hostFollowsRaider === null,
      raidsLastHour: request.raidsLastHour ?? 1,
      ...(request.practice ? { practice: request.practice } : {}),
    },
  };
}

export interface PreparedMatch {
  content: ContentPack;
  names: Map<string, string>;
}

export interface PendingRaid {
  decision: Decision;
  request: RaidRequest;
  expiresAt: number;
  preparation: Promise<PreparedMatch>;
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
  decionis?: DecionisOptions;
  history?: HostHistory;
  onSettle?: (result: CompletedMatch) => void | boolean | Promise<void | boolean>;
  onRetention?: (
    matchId: string,
    count: number,
    decision: Decision,
  ) => void | boolean | Promise<void | boolean>;
}
