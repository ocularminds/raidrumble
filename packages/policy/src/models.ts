export const actionNames = [
  'rumble.start',
  'rumble.start.collab',
  'content.render',
  'chat.send',
  'special.fire',
  'rewards.configure',
  'shoutout.send',
  'ledger.settle',
  'events.subscribe',
] as const;

export type ActionName = (typeof actionNames)[number];
export type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';
export type PolicyMode = 'shadow' | 'enforce';
export type FailureRule = 'ESCALATE' | 'BLOCK' | 'TEMPLATE' | 'SKIP' | 'LOCAL';

export interface ActionRequest {
  action: ActionName;
  actor: { kind: 'system' | 'host' | 'warlord' | 'viewer' | 'llm'; twitchUserId?: string };
  channel: { hostId: string; raiderId?: string };
  payload: Record<string, unknown>;
  matchId?: string;
}

export interface Decision {
  verdict: Verdict;
  reasonCodes: string[];
  decisionId: string;
  dossierId?: string;
  grant?: { id: string; expiresAt: number };
  approval?: { url: string; expiresAt: number };
  mode: PolicyMode;
  source: 'decionis' | 'local';
}

export interface PolicyGate {
  authorize(req: ActionRequest): Promise<Decision>;
  approve(decisionId: string, approverTwitchId: string): Promise<Decision>;
  claimGrant(grantId: string): Promise<boolean>;
  finalizeGrant?(grantId: string, outcome: GrantOutcome): Promise<boolean>;
}

export type GrantOutcome = 'COMMITTED' | 'FAILED' | 'INDETERMINATE';

export interface ConfigurablePolicyGate extends PolicyGate {
  getDecision(id: string): Decision | undefined;
  getRequest(id: string): ActionRequest | undefined;
  listRecords(): DecisionRecord[];
  getConfig(): PolicyConfig;
  setMode(action: ActionName, mode: PolicyMode): void;
  updateLists(lists: Partial<PolicyConfig['lists']>): void;
}

export interface PredicateRule {
  when: string;
  reason: string;
}
export interface ActionPolicy {
  mode?: PolicyMode;
  block: PredicateRule[];
  escalate?: PredicateRule[];
  allow: PredicateRule[];
  otherwise: { verdict: Verdict; reason: string; approver?: 'host'; timeoutMs?: number };
  onFailure: FailureRule;
}

export interface PolicyConfig {
  version: 1;
  defaults: { mode: PolicyMode; latencyBudgetMs: number };
  lists: { allow: string[]; block: string[]; blockedTerms: string[] };
  params: {
    minRaidSize: number;
    minRaiderAccountAgeDays: number;
    maxRaidsPerChannelPerHour: number;
    escalateTimeoutMs: number;
  };
  actions: Record<ActionName, ActionPolicy>;
}

export interface PolicyEvaluation {
  verdict: Verdict;
  reasonCodes: string[];
}
export interface DecisionRecord extends Decision {
  action: ActionName;
  hostId: string;
  atMs: number;
  unsigned: boolean;
  matchId?: string;
  expiresAt?: number;
}

export interface EvaluationContext {
  nowMs: number;
  getRequest(id: string): ActionRequest | undefined;
  getDecision(id: string): Decision | undefined;
}

export interface LocalPolicyOptions {
  now?: () => number;
  id?: () => string;
  logger?: (record: DecisionRecord) => void;
  evaluate?: (
    request: ActionRequest,
    config: PolicyConfig,
    context: EvaluationContext,
  ) => PolicyEvaluation | Promise<PolicyEvaluation>;
}

export interface ExecutionResult<T> {
  executed: boolean;
  value?: T;
  reason?: string;
}
export interface HelixWrite {
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}
export interface HelixCredentials {
  clientId: string;
  accessToken: string;
  fetch?: typeof fetch;
  apiBase?: string;
}
