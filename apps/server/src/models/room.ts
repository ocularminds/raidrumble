import type { ContentGenerator, Channels } from '@raidrumble/content';
import type { RoundResult } from '@raidrumble/engine';
import type { Decision, DecionisOptions, PolicyConfig } from '@raidrumble/policy';
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
  decionis?: DecionisOptions;
  history?: HostHistory;
  onSettle?: (result: CompletedMatch) => void | boolean | Promise<void | boolean>;
  onRetention?: (
    matchId: string,
    count: number,
    decision: Decision,
  ) => void | boolean | Promise<void | boolean>;
}
