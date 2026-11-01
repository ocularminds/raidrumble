import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { defaultPolicy } from './defaults.js';
import { actionNames } from './models.js';
import { budgetLimit } from './budget.js';
import type {
  ActionName,
  ActionPolicy,
  FailureRule,
  PolicyConfig,
  PolicyMode,
  PredicateRule,
  Verdict,
} from './models.js';
import { predicateNames } from './predicates.js';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown ${label}: ${key}`);
}

function number(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error('Invalid policy number');
  return value;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new Error(`Invalid ${label}`);
  return value as T;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new Error('Invalid policy text');
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('Invalid policy list');
  return value.map(text);
}

function rules(value: unknown): PredicateRule[] {
  if (!Array.isArray(value)) throw new Error('Invalid policy rules');
  return value.map((item: unknown) => {
    const entry = object(item, 'rule');
    keys(entry, ['when', 'reason'], 'rule field');
    const when = text(entry.when);
    if (!predicateNames.includes(when)) throw new Error(`Unknown policy predicate: ${when}`);
    return { when, reason: text(entry.reason) };
  });
}

function action(
  value: unknown,
  base: ActionPolicy,
  config: PolicyConfig,
  name: ActionName,
): ActionPolicy {
  const input = object(value, 'action');
  keys(
    input,
    ['mode', 'latencyBudgetMs', 'block', 'escalate', 'allow', 'otherwise', 'onFailure'],
    'action field',
  );
  const result = structuredClone(base);
  if (input.latencyBudgetMs !== undefined)
    result.latencyBudgetMs = number(input.latencyBudgetMs, 1, budgetLimit(name));
  if (input.mode !== undefined)
    result.mode = choice<PolicyMode>(input.mode, ['shadow', 'enforce'], 'mode');
  if (input.block !== undefined) result.block = rules(input.block);
  if (input.escalate !== undefined) result.escalate = rules(input.escalate);
  if (input.allow !== undefined) result.allow = rules(input.allow);
  if (input.onFailure !== undefined)
    result.onFailure = choice<FailureRule>(
      input.onFailure,
      ['ESCALATE', 'BLOCK', 'TEMPLATE', 'SKIP', 'LOCAL'],
      'onFailure',
    );
  if (input.otherwise !== undefined) {
    const otherwise = object(input.otherwise, 'otherwise');
    keys(otherwise, ['verdict', 'reason', 'approver', 'timeoutMs'], 'otherwise field');
    result.otherwise = {
      verdict: choice<Verdict>(otherwise.verdict, ['ALLOW', 'BLOCK', 'ESCALATE'], 'verdict'),
      reason: text(otherwise.reason),
    };
    if (otherwise.approver !== undefined)
      result.otherwise.approver = choice<'host'>(otherwise.approver, ['host'], 'approver');
    if (otherwise.timeoutMs !== undefined) {
      result.otherwise.timeoutMs =
        otherwise.timeoutMs === 'params.escalateTimeoutMs'
          ? config.params.escalateTimeoutMs
          : number(otherwise.timeoutMs, 1, 10_000);
    }
  }
  return result;
}

export function parsePolicy(source: string): PolicyConfig {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`Invalid policy YAML: ${doc.errors[0]?.message}`);
  const input = object(doc.toJS({ maxAliasCount: 50 }) as unknown, 'policy');
  keys(input, ['version', 'defaults', 'lists', 'params', 'actions'], 'policy field');
  if (input.version !== 1) throw new Error('Unsupported policy version');
  const config = defaultPolicy();
  if (input.defaults !== undefined) {
    const defaults = object(input.defaults, 'defaults');
    keys(defaults, ['mode', 'latencyBudgetMs'], 'default');
    if (defaults.mode !== undefined)
      config.defaults.mode = choice(defaults.mode, ['shadow', 'enforce'], 'mode');
    if (defaults.latencyBudgetMs !== undefined)
      config.defaults.latencyBudgetMs = number(defaults.latencyBudgetMs, 1, 120);
  }
  if (input.lists !== undefined) {
    const lists = object(input.lists, 'lists');
    keys(lists, ['allow', 'block', 'blockedTerms'], 'list');
    for (const name of ['allow', 'block', 'blockedTerms'] as const)
      if (lists[name] !== undefined) config.lists[name] = strings(lists[name]);
  }
  if (input.params !== undefined) {
    const params = object(input.params, 'params');
    keys(params, Object.keys(config.params), 'parameter');
    for (const name of Object.keys(config.params) as (keyof PolicyConfig['params'])[]) {
      if (params[name] !== undefined)
        config.params[name] = number(
          params[name],
          name === 'minRaiderAccountAgeDays' ? 0 : 1,
          name === 'escalateTimeoutMs' ? 10_000 : undefined,
        );
    }
  }
  if (input.actions !== undefined) {
    const actions = object(input.actions, 'actions');
    keys(actions, [...actionNames], 'action');
    for (const name of actionNames)
      if (actions[name] !== undefined)
        config.actions[name] = action(actions[name], config.actions[name], config, name);
  }
  return config;
}

export async function loadPolicy(path: string | URL): Promise<PolicyConfig> {
  return parsePolicy(await readFile(path, 'utf8'));
}
