import { vi } from 'vitest';
import { DecionisGate } from '../src/decionis/gate.js';
import { defaultPolicy } from '../src/defaults.js';
import type { PolicyMode } from '../src/models.js';

export const orgId = '11111111-1111-4111-8111-111111111111';
export const decisionId = '22222222-2222-4222-8222-222222222222';
export const dossierId = '33333333-3333-4333-8333-333333333333';
export const grantId = '44444444-4444-4444-8444-444444444444';
export const escalationId = '55555555-5555-4555-8555-555555555555';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
  return value as Record<string, unknown>;
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

export class HostedFixture {
  time = Date.parse('2026-10-31T12:00:00Z');
  counter = 0;
  readonly calls: { path: string; body: Record<string, unknown>; key: string | null }[] = [];
  intent: Record<string, unknown> = {};
  hash = '';
  handler?: (path: string, body: Record<string, unknown>) => Response | Promise<Response>;
  readonly fetch = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? object(JSON.parse(String(init.body))) : {};
    this.calls.push({ path, body, key: new Headers(init?.headers).get('authorization') });
    if (path === '/v1/authority/grants') {
      const { intent_hash, ...binding } = body;
      delete binding.mode;
      delete binding.escalation;
      this.intent = binding;
      this.hash = String(intent_hash);
    }
    if (this.handler) return this.handler(path, body);
    return this.respond(path, body);
  });

  respond(path: string, body: Record<string, unknown>): Response {
    if (path.endsWith('/claims')) return json(this.claim());
    if (path.endsWith('/receipts')) return json({ finalized: true, reason_codes: [] });
    if (path === '/v1/protocol/evaluate-decision')
      return json({
        outcome: 'APPROVE',
        verdict: 'ALLOW',
        evaluation_id: decisionId,
        dossier_id: dossierId,
        mode: 'SHADOW',
        reason_codes: ['HOSTED_ALLOW'],
      });
    return json(this.decision(body.mode === 'SHADOW' ? 'shadow' : 'enforce'));
  }

  decision(mode: PolicyMode = 'enforce', status = 'ALLOW'): Record<string, unknown> {
    const allowed = mode === 'enforce' && status === 'ALLOW';
    return {
      decision_id: decisionId,
      chain_id: null,
      status,
      should_execute: allowed,
      reason_codes: [`HOSTED_${status}`],
      action_hash: this.hash,
      policy_version: 'raidrumble.v1',
      mode: mode === 'shadow' ? 'SHADOW' : 'ENFORCEMENT',
      authority_classification: mode === 'shadow' ? 'OBSERVATIONAL' : 'AUTHORITATIVE',
      execution_eligible: allowed,
      execution_binding_digest: allowed ? `sha256:${'a'.repeat(64)}` : null,
      execution_token: allowed ? 'private.execution.bearer' : null,
      execution_token_jti: allowed ? grantId : null,
      execution_token_key_id: allowed ? 'signing.key' : null,
      execution_token_expires_at: allowed ? this.intent.expires_at : null,
      dossier_id: dossierId,
      dossier_sha256: 'dossier.hash',
      dossier_url: null,
      approval_request_id: null,
      ledger_entry_id: null,
    };
  }

  claim(): Record<string, unknown> {
    const actor = object(this.intent.actor);
    const action = object(this.intent.action);
    const target = object(this.intent.downstream_target);
    return {
      valid: true,
      should_execute: true,
      reason_codes: [],
      claim_token: 'c'.repeat(43),
      claim_validated_at: new Date(this.time).toISOString(),
      claim_lease_expires_at: new Date(this.time + 10_000).toISOString(),
      claim_attestation: 'signed.claim.attestation',
      claims: {
        jti: grantId,
        decision_id: decisionId,
        dossier_id: dossierId,
        org_id: orgId,
        sub: actor.id,
        action: action.type,
        aud: `${target.system}:${target.operation}`,
        exp: Date.parse(String(this.intent.expires_at)) / 1_000,
        binding: { intent_hash: this.hash },
      },
    };
  }

  hold(): Record<string, unknown> {
    return {
      ...this.decision('enforce', 'ESCALATE'),
      managed_escalation: {
        outcome: 'ESCALATE_PENDING',
        escalation_id: escalationId,
        intent_id: this.intent.intent_id,
        status: 'AWAITING_APPROVER',
        expires_at: this.intent.expires_at,
        reason_codes: ['PRESENCE_REQUIRED'],
      },
    };
  }

  status(status = 'AWAITING_APPROVER'): Record<string, unknown> {
    return {
      escalation_id: escalationId,
      intent_id: this.intent.intent_id,
      action_hash: this.hash,
      status,
      outcome: status === 'GRANT_READY' ? 'ALLOW' : 'ESCALATE_PENDING',
      expires_at: this.intent.expires_at,
      reason_codes: [],
      decision:
        status === 'GRANT_READY' ? { ...this.decision(), decision_id: 'ready.decision' } : null,
    };
  }

  gate(mode: PolicyMode = 'enforce', shadowRoute: 'authority' | 'protocol' = 'authority') {
    const config = defaultPolicy();
    config.defaults.mode = mode;
    config.lists.allow = ['trusted'];
    config.lists.block = ['blocked'];
    const logger = vi.fn();
    const gate = new DecionisGate(config, {
      apiKey: 'runtime.shadow.key',
      enforceApiKey: 'runtime.enforce.key',
      orgId,
      fetch: this.fetch,
      now: () => this.time,
      logger,
      shadowRoute,
      id: () => `66666666-6666-4666-8666-${String(++this.counter).padStart(12, '0')}`,
    });
    return { gate, logger };
  }
}
