import type { Decision, LocalPolicyOptions, PolicyMode } from '../models.js';
import type { PolicySelection } from './selection.js';
import type { RuntimeAssertion } from './assertion.js';

export interface DecionisOptions extends Omit<LocalPolicyOptions, 'evaluate'>, PolicySelection {
  apiBase?: string;
  apiKey?: string;
  enforceApiKey?: string;
  orgId?: string;
  fetch?: typeof fetch;
  shadowRoute?: 'authority' | 'protocol';
}

export interface IntentBinding {
  protocol_version: 'agent-safe.intent/1';
  tenant_id: string;
  intent_id: string;
  captured_at: string;
  expires_at: string;
  actor: { id: string; type: string };
  action: { type: string; resource: string; parameters: Record<string, unknown> };
  context: { idempotency_key: string; raidrumble?: RuntimeAssertion };
  downstream_target: { system: string; operation: string };
}

export interface CapturedIntent {
  binding: IntentBinding;
  hash: string;
}

export interface HostedGrant {
  id: string;
  token: string;
  expiresAt: number;
  decisionId: string;
  dossierId: string;
  captured: CapturedIntent;
}

export interface ManagedEscalation {
  id: string;
  intentId: string;
  expiresAt: number;
  status: string;
}

export interface HostedDecision {
  decision: Decision;
  grant?: HostedGrant;
  escalation?: ManagedEscalation;
}

export interface WireContext {
  captured: CapturedIntent;
  mode: PolicyMode;
  nowMs: number;
}
