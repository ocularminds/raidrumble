import type { ActionName, ActionRequest, PolicyEvaluation, Verdict } from '../models.js';

/** Authenticated runtime facts; this is not hosted Presence approval evidence. */
export interface RuntimeAssertion {
  application: 'raidrumble';
  schema: 1;
  action: ActionName;
  localVerdict: Verdict;
  localReasonCodes: string[];
  localHostApproved: boolean;
}

export class LocalAssertion {
  static capture(
    req: ActionRequest,
    evaluation: PolicyEvaluation,
    localHostApproved = false,
  ): RuntimeAssertion {
    return {
      application: 'raidrumble',
      schema: 1,
      action: req.action,
      localVerdict: evaluation.verdict,
      localReasonCodes: [...evaluation.reasonCodes],
      localHostApproved,
    };
  }
}
