import type { ActionRequest, EvaluationContext, PolicyConfig, PolicyEvaluation } from './models.js';
import { evaluatePredicate } from './predicates.js';
import { validateRequest } from './validation.js';

export function evaluateRules(
  req: ActionRequest,
  config: PolicyConfig,
  context: EvaluationContext,
): PolicyEvaluation {
  validateRequest(req);
  const action = config.actions[req.action];
  for (const verdict of ['BLOCK', 'ESCALATE', 'ALLOW'] as const) {
    const rules =
      verdict === 'BLOCK'
        ? action.block
        : verdict === 'ESCALATE'
          ? (action.escalate ?? [])
          : action.allow;
    const matches = rules.filter((rule) => evaluatePredicate(rule.when, req, config, context));
    if (matches.length) return { verdict, reasonCodes: matches.map((rule) => rule.reason) };
  }
  return { verdict: action.otherwise.verdict, reasonCodes: [action.otherwise.reason] };
}
