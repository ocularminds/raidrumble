import type { MatchView } from '@raidrumble/engine';
import type { LiveStatus } from './live/model.js';

export type Scenario = 'normal' | 'stranger-raid' | 'hate-raid' | 'collab';
export type OverlayLayout = 'lower' | 'rail' | 'full';

export interface DecisionView {
  decisionId: string;
  action: string;
  verdict: 'ALLOW' | 'BLOCK' | 'ESCALATE';
  reasonCodes: readonly string[];
  mode: 'shadow' | 'enforce';
  source: 'local' | 'decionis';
  dossierId?: string;
}

export interface ArenaView {
  hostId: string;
  status: 'idle' | 'incoming' | 'pending' | 'active' | 'afterglow';
  hostName: string;
  raiderName: string;
  connected: boolean;
  reducedMotion: boolean;
  /** Missing values from older clients/settings use Lower Third with sound off. */
  layout?: OverlayLayout;
  sound?: boolean;
  simulated: boolean;
  practice?: 'realchat';
  match?: MatchView;
  decision?: DecisionView;
  incoming?: { expiresAt: number };
  pending?: { decisionId: string; expiresAt: number; viewers?: number; raiderLogin?: string };
  afterglow?: { count: number; remainingMs: number };
  rematch?: string;
}

export interface DashboardView {
  arena: ArenaView;
  decisions: readonly DecisionView[];
  settings: {
    allow: readonly string[];
    block: readonly string[];
    blockedTerms: readonly string[];
    mode: 'shadow' | 'enforce';
    reducedMotion: boolean;
    layout?: OverlayLayout;
    sound?: boolean;
    facts: readonly string[];
  };
  twitch: LiveStatus;
  approval?: { source: 'local' | 'decionis'; url?: string; expiresAt: number };
  overlayUrl: string;
  budgets?: { ram: 0 | 1; oil: 0 | 1; reinforcedUsers: number };
  shared?: readonly string[];
  sharedChannels?: readonly { id: string; name: string }[];
}
