import type { MatchView } from '@raidrumble/engine';
import type { Decision } from '@raidrumble/policy';
import type { ArenaView, DashboardView } from '../model.js';
import type { RaidRequest } from './room.js';
import { raidLogin } from './room.js';
import { decisionView } from './decision.js';

interface ArenaState {
  hostId: string;
  now: number;
  labels: { hostName: string; raiderName: string };
  settings: DashboardView['settings'];
  request?: RaidRequest;
  pending?: { decision: Decision; request: RaidRequest; expiresAt: number };
  incoming?: { request: RaidRequest; expiresAt: number };
  decision?: Decision;
  action: string;
  match?: MatchView;
  hasGame: boolean;
  glow?: { count: number; remainingMs: number };
  rematch?: string;
}

/** Projects private lifecycle state to the public overlay without tokens or raw channel data. */
export function arenaView(state: ArenaState): ArenaView {
  const pending = state.pending && state.pending.expiresAt > state.now ? state.pending : undefined;
  const request = pending?.request ?? state.incoming?.request ?? state.request;
  const login = pending && raidLogin(pending.request);
  return {
    hostId: state.hostId,
    ...state.labels,
    connected: true,
    reducedMotion: state.settings.reducedMotion,
    layout: state.settings.layout,
    sound: state.settings.sound,
    simulated: request?.simulated ?? state.hostId === 'demo',
    ...(request?.practice ? { practice: request.practice } : {}),
    status: pending
      ? 'pending'
      : state.incoming
        ? 'incoming'
        : !state.hasGame && state.glow
          ? 'afterglow'
          : state.match
            ? 'active'
            : 'idle',
    match: state.match,
    decision: state.decision && decisionView(state.decision, state.action),
    rematch: state.rematch,
    ...(state.incoming && !pending ? { incoming: { expiresAt: state.incoming.expiresAt } } : {}),
    ...(pending
      ? {
          pending: {
            decisionId: pending.decision.decisionId,
            expiresAt: pending.expiresAt,
            ...(Number.isSafeInteger(pending.request.viewers) && pending.request.viewers >= 0
              ? { viewers: pending.request.viewers }
              : {}),
            ...(login ? { raiderLogin: login } : {}),
          },
        }
      : {}),
    ...(state.glow ? { afterglow: state.glow } : {}),
  };
}
