import type { ActionName, PolicyConfig } from './models.js';

const setup: readonly ActionName[] = [
  'rumble.start',
  'rumble.start.collab',
  'rewards.configure',
  'events.subscribe',
];

export function budgetLimit(action: ActionName): number {
  return setup.includes(action) ? 1500 : 120;
}

/** Configuration may reduce an allowance, but cannot widen an action's contract. */
export function actionBudget(config: PolicyConfig, action: ActionName): number {
  const configured = config.actions[action].latencyBudgetMs ?? config.defaults.latencyBudgetMs;
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(budgetLimit(action), Math.floor(configured)))
    : 1;
}

export function approvalTimeout(config: PolicyConfig, action: ActionName): number {
  const configured = config.actions[action].otherwise.timeoutMs ?? config.params.escalateTimeoutMs;
  return Number.isFinite(configured) ? Math.max(1, Math.min(10_000, Math.floor(configured))) : 1;
}

/** Captured once for authorization and its immediate claim; human approval opens a new window. */
export class AuthorizationWindow {
  readonly budgetMs: number;
  readonly deadline: number;

  constructor(config: PolicyConfig, action: ActionName, now: number, approvalDeadline = Infinity) {
    this.budgetMs = actionBudget(config, action);
    this.deadline = Math.min(now + this.budgetMs, approvalDeadline);
  }

  remaining(now: number): number {
    return Math.max(0, Math.min(this.budgetMs, this.deadline - now));
  }
}
