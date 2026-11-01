import { createHash } from 'node:crypto';
import type { ActionRequest, Decision, Verdict } from '../models.js';
import type {
  CapturedIntent,
  HostedDecision,
  IntentBinding,
  ManagedEscalation,
  WireContext,
} from './models.js';
import { canonical, codes, hash, record, text, timestamp, uuid } from './shape.js';
import { PolicySelector, type PolicySelection } from './selection.js';
import type { RuntimeAssertion } from './assertion.js';

const outcomes: Record<string, Verdict> = {
  APPROVE: 'ALLOW',
  REJECT: 'BLOCK',
  ESCALATE: 'ESCALATE',
  REVIEW: 'ESCALATE',
};
const statuses: Record<string, Verdict> = {
  ALLOW: 'ALLOW',
  BLOCK: 'BLOCK',
  ESCALATE: 'ESCALATE',
  REVIEW_REQUIRED: 'ESCALATE',
};
const pending = [
  'PENDING_PRESENCE',
  'PRESENCE_REQUESTED',
  'AWAITING_APPROVER',
  'PRESENCE_VERIFIED',
  'REAUTHORIZING',
];
const terminal = ['EXPIRED', 'REJECTED', 'BLOCKED', 'CANCELLED', 'FAILED'];

/** Confirmed contract: https://docs.decionis.com/.well-known/openapi.json (0.6.0). */
export class DecionisMapping {
  static capture(
    req: ActionRequest,
    orgId: string | undefined,
    id: string,
    nowMs: number,
    deadline: number,
    policy: PolicySelection = {},
    assertion?: RuntimeAssertion,
  ): CapturedIntent {
    if (deadline <= nowMs || deadline > nowMs + 300_000) throw new Error('POLICY_ERROR');
    const binding: IntentBinding = {
      protocol_version: 'agent-safe.intent/1',
      tenant_id: uuid(orgId),
      intent_id: uuid(id),
      captured_at: new Date(nowMs).toISOString(),
      expires_at: new Date(deadline).toISOString(),
      actor: { id: req.actor.twitchUserId ?? 'raidrumble:system', type: req.actor.kind },
      action: {
        type: req.action,
        resource: `twitch:channel:${req.channel.hostId}`,
        parameters: {
          ...new PolicySelector(policy).parameters(),
          channel: req.channel,
          payload: req.payload,
          ...(req.matchId === undefined ? {} : { matchId: req.matchId }),
        },
      },
      context: {
        idempotency_key: id,
        ...(assertion ? { raidrumble: structuredClone(assertion) } : {}),
      },
      downstream_target: {
        system: ['chat.send', 'shoutout.send', 'events.subscribe', 'rewards.configure'].includes(
          req.action,
        )
          ? 'twitch'
          : 'raidrumble',
        operation: req.action,
      },
    };
    return {
      binding,
      hash: `sha256:${createHash('sha256').update(canonical(binding), 'utf8').digest('hex')}`,
    };
  }

  static protocol(data: unknown, policy: PolicySelection = {}): Decision {
    const body = record(data);
    new PolicySelector(policy).verify(body, true);
    const outcome = text(body.outcome);
    const verdict = Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    if (
      !verdict ||
      body.mode !== 'SHADOW' ||
      (body.verdict !== undefined && body.verdict !== verdict) ||
      (body.authority_classification !== undefined &&
        body.authority_classification !== 'OBSERVATIONAL') ||
      (body.execution_eligible !== undefined && body.execution_eligible !== false)
    )
      throw new Error('POLICY_ERROR');
    return {
      verdict,
      decisionId: text(body.evaluation_id),
      dossierId: text(body.dossier_id),
      reasonCodes:
        body.reason_codes === undefined
          ? [`PROTOCOL_OUTCOME_${String(body.outcome)}`]
          : codes(body.reason_codes),
      mode: 'shadow',
      source: 'decionis',
    };
  }

  static authority(data: unknown, ctx: WireContext): HostedDecision {
    const body = record(data);
    PolicySelector.captured(ctx.captured.binding.action.parameters).verify(body);
    const status = text(body.status);
    const verdict = Object.hasOwn(statuses, status) ? statuses[status] : undefined;
    if (
      !verdict ||
      hash(body.action_hash) !== ctx.captured.hash ||
      body.mode !== (ctx.mode === 'shadow' ? 'SHADOW' : 'ENFORCEMENT')
    )
      throw new Error('POLICY_ERROR');
    const decision: Decision = {
      verdict,
      reasonCodes: codes(body.reason_codes),
      decisionId: text(body.decision_id),
      mode: ctx.mode,
      source: 'decionis',
      ...(body.dossier_id == null ? {} : { dossierId: text(body.dossier_id) }),
    };
    const escalation =
      body.managed_escalation == null ? undefined : this.escalation(body.managed_escalation, ctx);
    if (escalation || ctx.mode === 'shadow' || verdict !== 'ALLOW') {
      if (
        body.should_execute !== false ||
        body.execution_eligible !== false ||
        body.execution_token !== null ||
        body.execution_token_jti !== null ||
        body.execution_token_expires_at !== null ||
        body.execution_binding_digest !== null
      )
        throw new Error('POLICY_ERROR');
      if (escalation) return { decision: { ...decision, verdict: 'ESCALATE' }, escalation };
      return { decision };
    }
    if (
      body.should_execute !== true ||
      body.execution_eligible !== true ||
      body.authority_classification !== 'AUTHORITATIVE' ||
      !decision.dossierId
    )
      throw new Error('POLICY_ERROR');
    hash(body.execution_binding_digest);
    const expiresAt = timestamp(body.execution_token_expires_at);
    if (expiresAt <= ctx.nowMs || expiresAt > Date.parse(ctx.captured.binding.expires_at))
      throw new Error('POLICY_ERROR');
    const grant = {
      id: uuid(body.execution_token_jti),
      token: text(body.execution_token, 20_000),
      expiresAt,
      decisionId: decision.decisionId,
      dossierId: decision.dossierId,
      captured: ctx.captured,
    };
    return { decision: { ...decision, grant: { id: grant.id, expiresAt } }, grant };
  }

  static escalation(value: unknown, ctx: WireContext): ManagedEscalation {
    const body = record(value);
    const status = text(body.status);
    const expected =
      status === 'GRANT_READY'
        ? 'ALLOW'
        : status === 'FAILED'
          ? 'ERROR'
          : terminal.includes(status)
            ? 'BLOCK'
            : 'ESCALATE_PENDING';
    const expiresAt = timestamp(body.expires_at);
    if (
      ctx.mode !== 'enforce' ||
      (!pending.includes(status) && !terminal.includes(status) && status !== 'GRANT_READY') ||
      body.outcome !== expected ||
      body.intent_id !== ctx.captured.binding.intent_id ||
      expiresAt > Date.parse(ctx.captured.binding.expires_at) ||
      expiresAt <= ctx.nowMs
    )
      throw new Error('POLICY_ERROR');
    codes(body.reason_codes);
    return { id: uuid(body.escalation_id), intentId: text(body.intent_id), expiresAt, status };
  }

  static status(
    value: unknown,
    expected: ManagedEscalation,
    ctx: WireContext,
  ): HostedDecision | undefined {
    const body = record(value);
    const current = this.escalation(body, ctx);
    if (
      current.id !== expected.id ||
      current.expiresAt !== expected.expiresAt ||
      hash(body.action_hash) !== ctx.captured.hash
    )
      throw new Error('POLICY_ERROR');
    if (terminal.includes(current.status)) throw new Error('Hosted approval closed');
    if (current.status === 'GRANT_READY') {
      const result = this.authority(body.decision, ctx);
      if (result.decision.verdict !== 'ALLOW' || !result.grant || result.escalation)
        throw new Error('POLICY_ERROR');
      return result;
    }
    if (
      body.decision !== null ||
      pending.indexOf(current.status) < pending.indexOf(expected.status) ||
      expected.status === 'GRANT_READY'
    )
      throw new Error('POLICY_ERROR');
    expected.status = current.status;
    return undefined;
  }
}
