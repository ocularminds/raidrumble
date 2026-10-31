import type { MatchView } from '@raidrumble/engine';

export type Scenario = 'normal' | 'stranger-raid' | 'hate-raid' | 'collab';

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
  status: 'idle' | 'pending' | 'active' | 'afterglow';
  hostName: string;
  raiderName: string;
  connected: boolean;
  reducedMotion: boolean;
  simulated: boolean;
  match?: MatchView;
  decision?: DecisionView;
  pending?: { decisionId: string; expiresAt: number };
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
    facts: readonly string[];
  };
  twitch: { configured: boolean; hostConnected: boolean; botConnected: boolean };
  overlayUrl: string;
  budgets?: { ram: 0 | 1; oil: 0 | 1; reinforcedUsers: number };
  shared?: readonly string[];
}
