import { createHash } from 'node:crypto';
import type { GrantOutcome } from '../models.js';
import type { HostedGrant } from './models.js';
import { canonical, codes, hash, record, text, timestamp } from './shape.js';
import type { DecionisTransport } from './transport.js';
import { AuthorityFailure } from './errors.js';
import type { AuthorizationWindow } from '../budget.js';

interface GrantState {
  grant: HostedGrant;
  state: 'issued' | 'claiming' | 'claimed' | 'finished';
  claimToken?: string;
  leaseExpiresAt?: number;
  unavailable?: boolean;
  allowance?: { deadline: number; budgetMs: number };
  claimExpired?: boolean;
}

/** Bearer material never enters a public Decision or a structured decision record. */
export class HostedGrants {
  private readonly grants = new Map<string, GrantState>();

  constructor(
    private readonly transport: DecionisTransport,
    private readonly now: () => number,
  ) {}

  add(grant: HostedGrant, allowance?: AuthorizationWindow): void {
    this.prune();
    if (this.grants.has(grant.id) || this.grants.size >= 10_000) throw new Error('POLICY_ERROR');
    this.grants.set(grant.id, {
      grant: structuredClone(grant),
      state: 'issued',
      ...(allowance
        ? { allowance: { deadline: allowance.deadline, budgetMs: allowance.budgetMs } }
        : {}),
    });
  }

  async claim(id: string, budgetMs: number): Promise<boolean> {
    const entry = this.grants.get(id);
    if (!entry || entry.state !== 'issued' || entry.grant.expiresAt <= this.now()) return false;
    const budget = entry.allowance
      ? Math.min(entry.allowance.budgetMs, entry.allowance.deadline - this.now())
      : Math.min(120, budgetMs);
    if (budget <= 0) return false;
    entry.state = 'claiming';
    const grant = entry.grant;
    const binding = grant.captured.binding;
    try {
      const data = record(
        await this.transport.request(
          `/v1/authority/grants/${encodeURIComponent(id)}/claims`,
          'enforce',
          budget,
          {
            execution_token: grant.token,
            intent_hash: grant.captured.hash,
            intent: binding,
            consumed_by: binding.actor.id,
            commit_correlation_id: binding.intent_id,
          },
        ),
      );
      const claims = record(data.claims);
      const claimBinding = record(claims.binding);
      const lease = timestamp(data.claim_lease_expires_at);
      const validated = timestamp(data.claim_validated_at);
      const token = text(data.claim_token);
      const payloadDigest = claimBinding.execution_payload_digest;
      if (
        payloadDigest != null &&
        (claimBinding.execution_payload_canonicalization_profile !== 'RFC8785/JCS' ||
          payloadDigest !==
            `sha256:${createHash('sha256').update(canonical(binding.action.parameters)).digest('hex')}`)
      )
        return false;
      if (claimBinding.expected_effect_digest != null) return false;
      codes(data.reason_codes);
      text(data.claim_attestation, 20_000);
      if (
        data.valid !== true ||
        data.should_execute !== true ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(token) ||
        claims.jti !== id ||
        claims.decision_id !== grant.decisionId ||
        claims.dossier_id !== grant.dossierId ||
        claims.org_id !== binding.tenant_id ||
        claims.sub !== binding.actor.id ||
        claims.action !== binding.action.type ||
        claims.aud !==
          `${binding.downstream_target.system}:${binding.downstream_target.operation}` ||
        hash(claimBinding.intent_hash) !== grant.captured.hash ||
        claims.exp !== Math.floor(grant.expiresAt / 1_000) ||
        typeof claims.exp !== 'number' ||
        claims.exp * 1_000 <= this.now() ||
        validated > this.now() ||
        lease <= this.now() ||
        grant.expiresAt <= this.now()
      )
        return false;
      entry.claimToken = token;
      entry.leaseExpiresAt = lease;
      entry.claimExpired = entry.allowance !== undefined && entry.allowance.deadline <= this.now();
      entry.state = 'claimed';
      return true;
    } catch (error) {
      entry.unavailable = error instanceof AuthorityFailure && error.kind === 'unavailable';
      return false;
    }
  }

  window(id: string): { decisionId: string; expiresAt: number } | undefined {
    const entry = this.grants.get(id);
    return entry?.state === 'claimed' && entry.leaseExpiresAt !== undefined
      ? {
          decisionId: entry.grant.decisionId,
          expiresAt: Math.min(
            entry.grant.expiresAt,
            entry.leaseExpiresAt,
            entry.claimExpired ? this.now() : Infinity,
          ),
        }
      : undefined;
  }

  unavailableDecision(id: string): string | undefined {
    const entry = this.grants.get(id);
    return entry?.unavailable ? entry.grant.decisionId : undefined;
  }

  async finalize(id: string, outcome: GrantOutcome, budgetMs: number): Promise<boolean> {
    const entry = this.grants.get(id);
    if (!entry || entry.state !== 'claimed' || !entry.claimToken) return false;
    entry.state = 'finished';
    try {
      const result = record(
        await this.transport.request(
          `/v1/authority/grants/${encodeURIComponent(id)}/receipts`,
          'enforce',
          budgetMs,
          {
            execution_token: entry.grant.token,
            claim_token: entry.claimToken,
            outcome,
            commit_correlation_id: entry.grant.captured.binding.intent_id,
          },
        ),
      );
      codes(result.reason_codes);
      return (
        result.finalized === true && (result.outcome === undefined || result.outcome === outcome)
      );
    } catch {
      return false;
    } finally {
      delete entry.claimToken;
      entry.grant.token = '';
    }
  }

  private prune(): void {
    for (const [id, entry] of this.grants) {
      if (entry.state !== 'claimed' && entry.grant.expiresAt <= this.now()) this.grants.delete(id);
    }
  }
}
