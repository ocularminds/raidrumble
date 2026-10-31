import type {
  Decision,
  ExecutionResult,
  HelixCredentials,
  HelixWrite,
  GrantOutcome,
  PolicyGate,
} from './models.js';
import { decisionBook } from './receipts.js';
import { helixBase, matchesWrite } from './writes.js';

/** The sole effect boundary. Decisions and approval grants can execute once. */
export class PolicyExecutor {
  constructor(private readonly gate: PolicyGate) {}

  async execute<T>(decision: Decision, effect: () => T | Promise<T>): Promise<ExecutionResult<T>> {
    decision = structuredClone(decision);
    const book = decisionBook(this.gate);
    if (!book?.accepts(decision)) return { executed: false, reason: 'DECISION_INVALID_OR_USED' };
    const enforce =
      decision.mode === 'enforce' || book.failureRule(decision.decisionId) !== undefined;
    if (enforce && decision.verdict !== 'ALLOW')
      return { executed: false, reason: decision.verdict };
    if (!book.begin(decision)) return { executed: false, reason: 'DECISION_ALREADY_USED' };
    if (decision.source === 'decionis' && decision.mode === 'enforce' && !decision.grant)
      return { executed: false, reason: 'GRANT_REQUIRED' };
    if (decision.grant) {
      try {
        if (!(await this.gate.claimGrant(decision.grant.id)))
          return { executed: false, reason: book.claimFailure(decision.decisionId) };
      } catch {
        return { executed: false, reason: 'GRANT_INVALID_OR_USED' };
      }
    }
    if ((book.executionBudget(decision.decisionId) ?? 1) <= 0) {
      await this.finalize(decision, 'FAILED');
      return { executed: false, reason: 'GRANT_EXPIRED' };
    }
    let value: T;
    try {
      value = await effect();
    } catch {
      await this.finalize(decision, 'INDETERMINATE');
      return { executed: false, reason: 'EFFECT_FAILED' };
    }
    const finalized = await this.finalize(decision, 'COMMITTED');
    return { executed: true, value, ...(finalized ? {} : { reason: 'RECEIPT_PENDING' }) };
  }

  async executeHelix(
    decision: Decision,
    write: HelixWrite,
    credentials: HelixCredentials,
  ): Promise<ExecutionResult<unknown>> {
    decision = structuredClone(decision);
    write = structuredClone(write);
    credentials = { ...credentials };
    const req = decisionBook(this.gate)?.getRequest(decision.decisionId);
    if (!req || !matchesWrite(req, write)) return { executed: false, reason: 'REQUEST_MISMATCH' };
    let base: URL;
    try {
      base = helixBase(credentials.apiBase);
    } catch {
      return { executed: false, reason: 'INVALID_API_BASE' };
    }
    if (!credentials.clientId || !credentials.accessToken)
      return { executed: false, reason: 'MISSING_CREDENTIALS' };
    return this.execute(decision, async () => {
      const url = new URL(`${base.toString().replace(/\/$/, '')}${write.path}`);
      for (const [name, value] of Object.entries(write.query ?? {}))
        url.searchParams.set(name, value);
      const budget = decisionBook(this.gate)?.executionBudget(decision.decisionId) ?? 5000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(5000, budget)));
      try {
        const response = await (credentials.fetch ?? fetch)(url, {
          method: write.method,
          headers: {
            'Client-Id': credentials.clientId,
            Authorization: `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          ...(write.body === undefined ? {} : { body: JSON.stringify(write.body) }),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Helix HTTP ${response.status}`);
        if (response.status === 204) return undefined;
        const text = await response.text();
        if (text.length > 1_000_000) throw new Error('Helix response too large');
        return text ? (JSON.parse(text) as unknown) : undefined;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async finalize(decision: Decision, outcome: GrantOutcome): Promise<boolean> {
    if (!decision.grant || !this.gate.finalizeGrant) return true;
    try {
      return await this.gate.finalizeGrant(decision.grant.id, outcome);
    } catch {
      return false;
    }
  }
}
