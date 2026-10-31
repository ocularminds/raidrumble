import type { ActionRequest, Decision, FailureRule, PolicyGate } from './models.js';

interface Receipt {
  request: ActionRequest;
  decision: Decision;
  executed: boolean;
  expiresAt?: number;
  failureRule?: FailureRule;
  executionDeadline?: number;
  claimUnavailable?: boolean;
}
const books = new WeakMap<PolicyGate, DecisionBook>();

function equal(left: Decision, right: Decision): boolean {
  return (
    left.decisionId === right.decisionId &&
    left.verdict === right.verdict &&
    left.mode === right.mode &&
    left.source === right.source &&
    left.dossierId === right.dossierId &&
    left.grant?.id === right.grant?.id &&
    left.grant?.expiresAt === right.grant?.expiresAt &&
    left.approval?.url === right.approval?.url &&
    left.approval?.expiresAt === right.approval?.expiresAt &&
    left.reasonCodes.length === right.reasonCodes.length &&
    left.reasonCodes.every((code, index) => code === right.reasonCodes[index])
  );
}

/** Internal issuance registry: public JSON cannot manufacture an execution permit. */
export class DecisionBook {
  private readonly receipts = new Map<string, Receipt>();

  constructor(
    gate: PolicyGate,
    private readonly now: () => number = Date.now,
  ) {
    books.set(gate, this);
  }

  add(
    request: ActionRequest,
    decision: Decision,
    expiresAt?: number,
    failureRule?: FailureRule,
  ): void {
    if (this.receipts.has(decision.decisionId)) throw new Error('Duplicate decision ID');
    this.receipts.set(decision.decisionId, {
      request: structuredClone(request),
      decision: structuredClone(decision),
      executed: false,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(failureRule === undefined ? {} : { failureRule }),
    });
    while (this.receipts.size > 10_000) {
      const oldest = this.receipts.keys().next().value as string | undefined;
      if (oldest) this.receipts.delete(oldest);
      else break;
    }
  }

  replace(decision: Decision): void {
    const receipt = this.receipts.get(decision.decisionId);
    if (!receipt) throw new Error('Unknown decision');
    receipt.decision = structuredClone(decision);
  }

  getDecision(id: string): Decision | undefined {
    const decision = this.receipts.get(id)?.decision;
    return decision && structuredClone(decision);
  }

  getRequest(id: string): ActionRequest | undefined {
    const req = this.receipts.get(id)?.request;
    return req && structuredClone(req);
  }

  expiry(id: string): number | undefined {
    return this.receipts.get(id)?.expiresAt;
  }

  failureRule(id: string): FailureRule | undefined {
    return this.receipts.get(id)?.failureRule;
  }

  limitExecution(id: string, deadline: number): void {
    const receipt = this.receipts.get(id);
    if (receipt) receipt.executionDeadline = deadline;
  }

  executionBudget(id: string): number | undefined {
    const receipt = this.receipts.get(id);
    const expiry = receipt?.executionDeadline ?? receipt?.decision.grant?.expiresAt;
    return expiry === undefined ? undefined : expiry - this.now();
  }

  markClaimUnavailable(id: string): void {
    const receipt = this.receipts.get(id);
    if (receipt) receipt.claimUnavailable = true;
  }

  claimFailure(id: string): 'GRANT_UNAVAILABLE' | 'GRANT_INVALID_OR_USED' {
    return this.receipts.get(id)?.claimUnavailable ? 'GRANT_UNAVAILABLE' : 'GRANT_INVALID_OR_USED';
  }

  accepts(decision: Decision): boolean {
    const receipt = this.receipts.get(decision.decisionId);
    return !!receipt && equal(receipt.decision, decision) && !receipt.executed;
  }

  begin(decision: Decision): boolean {
    if (!this.accepts(decision)) return false;
    const receipt = this.receipts.get(decision.decisionId);
    if (!receipt) return false;
    receipt.executed = true;
    return true;
  }
}

export function decisionBook(gate: PolicyGate): DecisionBook | undefined {
  return books.get(gate);
}
