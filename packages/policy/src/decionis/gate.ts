import { randomUUID } from 'node:crypto';
import { defaultPolicy } from '../defaults.js';
import type {
  ActionName,
  ActionRequest,
  ConfigurablePolicyGate,
  Decision,
  DecisionRecord,
  FailureRule,
  GrantOutcome,
  PolicyConfig,
  PolicyEvaluation,
  PolicyMode,
} from '../models.js';
import { DecisionBook } from '../receipts.js';
import { evaluateRules } from '../rules.js';
import { HostedGrants } from './grants.js';
import { DecionisMapping } from './mapping.js';
import type {
  CapturedIntent,
  DecionisOptions,
  HostedDecision,
  ManagedEscalation,
} from './models.js';
import { uuid } from './shape.js';
import { DecionisTransport } from './transport.js';

export type { DecionisOptions } from './models.js';

interface PendingApproval {
  deadline: number;
  captured?: CapturedIntent;
  escalation?: ManagedEscalation;
  remote: boolean;
}

/** Local prerequisites followed by remotely bound authority, with unsigned failure receipts. */
export class DecionisGate implements ConfigurablePolicyGate {
  private config: PolicyConfig;
  private readonly options: DecionisOptions;
  private readonly book: DecisionBook;
  private readonly records: DecisionRecord[] = [];
  private readonly pending = new Map<string, PendingApproval>();
  private readonly approvals = new Map<string, Promise<Decision>>();
  private readonly transport: DecionisTransport;
  private readonly grants: HostedGrants;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(config: PolicyConfig = defaultPolicy(), options: DecionisOptions = {}) {
    this.config = structuredClone(config);
    this.options = { ...options };
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    this.book = new DecisionBook(this, this.now);
    this.transport = new DecionisTransport(this.options);
    this.grants = new HostedGrants(this.transport, this.now);
  }

  async authorize(request: ActionRequest): Promise<Decision> {
    const req = structuredClone(request);
    const config = this.getConfig();
    const deadline = this.now() + Math.min(10_000, config.params.escalateTimeoutMs);
    try {
      const local = this.evaluate(req, config);
      if (local.verdict !== 'ALLOW') return this.local(req, local, config, deadline);
    } catch {
      return this.failure(req, config, deadline, 'POLICY_ERROR');
    }
    return this.hosted(req, config, deadline);
  }

  async approve(decisionId: string, approverTwitchId: string): Promise<Decision> {
    const decision = this.getDecision(decisionId);
    const req = this.getRequest(decisionId);
    const pending = this.pending.get(decisionId);
    if (!decision || !req) throw new Error('Unknown decision');
    if (req.channel.hostId !== approverTwitchId) throw new Error('Invalid approver');
    if (decision.verdict !== 'ESCALATE' || !pending)
      throw new Error('Decision is not an escalation');
    if (pending.deadline <= this.now()) throw new Error('Approval expired');
    const existing = this.approvals.get(decisionId);
    if (existing) return structuredClone(await existing);
    if (!this.book.accepts(decision)) throw new Error('Decision already used');
    const operation = this.resolve(req, decision, pending);
    this.approvals.set(decisionId, operation);
    try {
      return structuredClone(await operation);
    } finally {
      this.approvals.delete(decisionId);
    }
  }

  async claimGrant(id: string): Promise<boolean> {
    const claimed = await this.grants.claim(id, this.config.defaults.latencyBudgetMs);
    const window = this.grants.window(id);
    if (claimed && window) this.book.limitExecution(window.decisionId, window.expiresAt);
    const unavailable = this.grants.unavailableDecision(id);
    if (!claimed && unavailable) this.book.markClaimUnavailable(unavailable);
    return claimed;
  }

  finalizeGrant(id: string, outcome: GrantOutcome): Promise<boolean> {
    return this.grants.finalize(id, outcome, this.config.defaults.latencyBudgetMs);
  }

  getDecision(id: string): Decision | undefined {
    return this.book.getDecision(id);
  }
  getRequest(id: string): ActionRequest | undefined {
    return this.book.getRequest(id);
  }
  listRecords(): DecisionRecord[] {
    return structuredClone(this.records);
  }
  getConfig(): PolicyConfig {
    return structuredClone(this.config);
  }
  setMode(action: ActionName, mode: PolicyMode): void {
    this.config.actions[action].mode = mode;
  }
  updateLists(lists: Partial<PolicyConfig['lists']>): void {
    this.config.lists = structuredClone({ ...this.config.lists, ...lists });
  }

  private evaluate(req: ActionRequest, config: PolicyConfig): PolicyEvaluation {
    return evaluateRules(req, config, {
      nowMs: this.now(),
      getRequest: (id) => this.getRequest(id),
      getDecision: (id) => this.getDecision(id),
    });
  }

  private async hosted(
    req: ActionRequest,
    config: PolicyConfig,
    deadline: number,
  ): Promise<Decision> {
    const mode = config.actions[req.action].mode ?? config.defaults.mode;
    try {
      if (deadline <= this.now()) throw new Error('POLICY_TIMEOUT');
      if (mode === 'shadow' && this.options.shadowRoute === 'protocol') {
        const id = this.id();
        const result = await this.transport.request(
          '/v1/protocol/evaluate-decision',
          mode,
          config.defaults.latencyBudgetMs,
          {
            org_id: uuid(this.options.orgId),
            decision_type: req.action,
            mode: 'SHADOW',
            context: req,
            idempotency_key: id,
          },
          id,
        );
        return this.issue(req, DecionisMapping.protocol(result), deadline);
      }
      const captured = DecionisMapping.capture(
        req,
        this.options.orgId,
        this.id(),
        this.now(),
        deadline,
      );
      const result = await this.transport.request(
        '/v1/authority/grants',
        mode,
        config.defaults.latencyBudgetMs,
        {
          ...captured.binding,
          intent_hash: captured.hash,
          mode: mode === 'shadow' ? 'SHADOW' : 'ENFORCEMENT',
          ...(mode === 'enforce' ? { escalation: { mode: 'MANAGED' } } : {}),
        },
        captured.binding.intent_id,
      );
      const mapped = DecionisMapping.authority(result, { captured, mode, nowMs: this.now() });
      return this.accept(req, mapped, deadline, captured);
    } catch (error) {
      return this.failure(
        req,
        config,
        deadline,
        error instanceof Error && error.message === 'POLICY_TIMEOUT'
          ? 'POLICY_TIMEOUT'
          : 'POLICY_ERROR',
      );
    }
  }

  private async resolve(
    req: ActionRequest,
    decision: Decision,
    pending: PendingApproval,
  ): Promise<Decision> {
    const config = this.getConfig();
    config.actions[req.action].mode = decision.mode;
    const local = this.evaluate(req, config);
    if (local.verdict === 'BLOCK') {
      this.book.begin(decision);
      this.pending.delete(decision.decisionId);
      return this.local(req, local, config, pending.deadline);
    }
    if (!pending.remote) {
      this.book.begin(decision);
      this.pending.delete(decision.decisionId);
      return this.hosted(req, config, pending.deadline);
    }
    if (!pending.captured || !pending.escalation) throw new Error('Hosted approval unavailable');
    const body = await this.transport.request(
      `/v1/authority/escalations/${encodeURIComponent(pending.escalation.id)}`,
      'enforce',
      config.defaults.latencyBudgetMs,
    );
    if (pending.deadline <= this.now()) throw new Error('Approval expired');
    const result = DecionisMapping.status(body, pending.escalation, {
      captured: pending.captured,
      mode: 'enforce',
      nowMs: this.now(),
    });
    if (!result) return decision;
    this.book.begin(decision);
    this.pending.delete(decision.decisionId);
    return this.accept(req, result, pending.deadline, pending.captured);
  }

  private accept(
    req: ActionRequest,
    result: HostedDecision,
    deadline: number,
    captured: CapturedIntent,
  ): Decision {
    if (result.grant) this.grants.add(result.grant);
    const decision = this.issue(req, result.decision, deadline);
    if (decision.verdict === 'ESCALATE')
      this.pending.set(decision.decisionId, {
        deadline,
        captured,
        remote: true,
        ...(result.escalation ? { escalation: result.escalation } : {}),
      });
    return decision;
  }

  private local(
    req: ActionRequest,
    evaluation: PolicyEvaluation,
    config: PolicyConfig,
    deadline: number,
    failureRule?: FailureRule,
  ): Decision {
    const decision = this.issue(
      req,
      {
        ...evaluation,
        decisionId: `local:${this.id()}`,
        source: 'local',
        mode: config.actions[req.action].mode ?? config.defaults.mode,
      },
      deadline,
      failureRule,
    );
    if (decision.verdict === 'ESCALATE')
      this.pending.set(decision.decisionId, { deadline, remote: false });
    return decision;
  }

  private failure(
    req: ActionRequest,
    config: PolicyConfig,
    deadline: number,
    reason: string,
  ): Decision {
    const rule = config.actions[req.action].onFailure;
    const evaluation: PolicyEvaluation =
      rule === 'ESCALATE'
        ? { verdict: 'ESCALATE', reasonCodes: [reason] }
        : rule === 'LOCAL'
          ? { verdict: 'ALLOW', reasonCodes: [reason, 'UNSIGNED_LEDGER_FALLBACK'] }
          : {
              verdict: 'BLOCK',
              reasonCodes: [
                reason,
                rule === 'TEMPLATE'
                  ? 'CONTENT_TEMPLATE_FALLBACK'
                  : rule === 'SKIP'
                    ? 'MESSAGE_SKIPPED'
                    : 'ACTION_BLOCKED',
              ],
            };
    return this.local(req, evaluation, config, deadline, rule);
  }

  private issue(
    req: ActionRequest,
    decision: Decision,
    deadline: number,
    failureRule?: FailureRule,
  ): Decision {
    this.book.add(
      req,
      decision,
      decision.verdict === 'ESCALATE' ? deadline : undefined,
      failureRule,
    );
    const record: DecisionRecord = {
      ...structuredClone(decision),
      action: req.action,
      hostId: req.channel.hostId,
      atMs: this.now(),
      unsigned: decision.source === 'local' || !decision.dossierId,
      ...(req.matchId === undefined ? {} : { matchId: req.matchId }),
      ...(decision.verdict === 'ESCALATE' ? { expiresAt: deadline } : {}),
    };
    this.records.push(record);
    if (this.records.length > 10_000) this.records.shift();
    for (const [id, entry] of this.pending)
      if (entry.deadline <= this.now() || !this.getDecision(id)) this.pending.delete(id);
    try {
      (this.options.logger ?? ((line) => console.info(JSON.stringify(line))))(
        structuredClone(record),
      );
    } catch {
      /* Logging never interrupts the match. */
    }
    return structuredClone(decision);
  }
}
