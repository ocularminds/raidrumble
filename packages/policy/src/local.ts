import { randomUUID } from 'node:crypto';
import { defaultPolicy } from './defaults.js';
import type {
  ActionName,
  ActionRequest,
  Decision,
  DecisionRecord,
  FailureRule,
  LocalPolicyOptions,
  PolicyConfig,
  PolicyEvaluation,
  PolicyGate,
  PolicyMode,
} from './models.js';
import { DecisionBook } from './receipts.js';
import { evaluateRules } from './rules.js';

interface Grant {
  decisionId: string;
  expiresAt: number;
  used: boolean;
}

export class LocalPolicyGate implements PolicyGate {
  private config: PolicyConfig;
  private readonly book: DecisionBook;
  private readonly records: DecisionRecord[] = [];
  private readonly grants = new Map<string, Grant>();
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly logger: NonNullable<LocalPolicyOptions['logger']>;
  private readonly evaluator: NonNullable<LocalPolicyOptions['evaluate']>;

  constructor(config: PolicyConfig = defaultPolicy(), options: LocalPolicyOptions = {}) {
    this.config = structuredClone(config);
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    this.logger = options.logger ?? ((record) => console.info(JSON.stringify(record)));
    this.evaluator = options.evaluate ?? evaluateRules;
    this.book = new DecisionBook(this, this.now);
  }

  async authorize(request: ActionRequest): Promise<Decision> {
    const req = structuredClone(request);
    const config = structuredClone(this.config);
    const action = config.actions[req.action];
    const atMs = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let evaluation: PolicyEvaluation;
    let failureRule: FailureRule | undefined;
    try {
      evaluation = await Promise.race([
        Promise.resolve().then(() =>
          this.evaluator(req, config, {
            nowMs: atMs,
            getRequest: (id) => this.getRequest(id),
            getDecision: (id) => this.getDecision(id),
          }),
        ),
        new Promise<PolicyEvaluation>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('POLICY_TIMEOUT')),
            config.defaults.latencyBudgetMs,
          );
        }),
      ]);
    } catch (error) {
      const reason =
        error instanceof Error && error.message === 'POLICY_TIMEOUT'
          ? 'POLICY_TIMEOUT'
          : 'POLICY_ERROR';
      evaluation = this.failure(req.action, config, reason);
      failureRule = action.onFailure;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const decision: Decision = {
      ...evaluation,
      decisionId: `local:${this.id()}`,
      mode: action.mode ?? config.defaults.mode,
      source: 'local',
    };
    const expiresAt =
      decision.verdict === 'ESCALATE'
        ? this.now() + (action.otherwise.timeoutMs ?? config.params.escalateTimeoutMs)
        : undefined;
    this.book.add(req, decision, expiresAt, failureRule);
    this.record(req, decision, atMs, expiresAt);
    this.pruneGrants();
    return structuredClone(decision);
  }

  async approve(decisionId: string, approverTwitchId: string): Promise<Decision> {
    const decision = this.getDecision(decisionId);
    const req = this.getRequest(decisionId);
    if (!decision || !req) throw new Error('Unknown decision');
    if (decision.grant) throw new Error('Decision already approved');
    if (decision.verdict !== 'ESCALATE') throw new Error('Decision is not an escalation');
    if (req.channel.hostId !== approverTwitchId) throw new Error('Invalid approver');
    if ((this.book.expiry(decisionId) ?? 0) <= this.now()) throw new Error('Approval expired');
    if (!this.book.accepts(decision)) throw new Error('Decision already executed');
    const grant = { id: `grant:${this.id()}`, expiresAt: this.now() + 10_000 };
    const approved: Decision = {
      ...decision,
      verdict: 'ALLOW',
      reasonCodes: [...decision.reasonCodes, 'HOST_APPROVED'],
      grant,
    };
    this.grants.set(grant.id, { decisionId, expiresAt: grant.expiresAt, used: false });
    this.book.replace(approved);
    this.record(req, approved, this.now());
    return structuredClone(approved);
  }

  async claimGrant(grantId: string): Promise<boolean> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.used || grant.expiresAt <= this.now()) return false;
    if (this.getDecision(grant.decisionId)?.grant?.id !== grantId) return false;
    grant.used = true;
    return true;
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

  private failure(action: ActionName, config: PolicyConfig, reason: string): PolicyEvaluation {
    const rule = config.actions[action].onFailure;
    if (rule === 'ESCALATE') return { verdict: 'ESCALATE', reasonCodes: [reason] };
    if (rule === 'LOCAL')
      return { verdict: 'ALLOW', reasonCodes: [reason, 'UNSIGNED_LEDGER_FALLBACK'] };
    const code =
      rule === 'TEMPLATE'
        ? 'CONTENT_TEMPLATE_FALLBACK'
        : rule === 'SKIP'
          ? 'MESSAGE_SKIPPED'
          : 'ACTION_BLOCKED';
    return { verdict: 'BLOCK', reasonCodes: [reason, code] };
  }

  private record(req: ActionRequest, decision: Decision, atMs: number, expiresAt?: number): void {
    const record: DecisionRecord = {
      ...structuredClone(decision),
      action: req.action,
      hostId: req.channel.hostId,
      atMs,
      unsigned: true,
      ...(req.matchId === undefined ? {} : { matchId: req.matchId }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    this.records.push(record);
    if (this.records.length > 10_000) this.records.shift();
    try {
      this.logger(structuredClone(record));
    } catch {
      /* Logging must not interrupt a live match. */
    }
  }

  private pruneGrants(): void {
    for (const [id, grant] of this.grants)
      if (grant.used || grant.expiresAt <= this.now()) this.grants.delete(id);
  }
}
