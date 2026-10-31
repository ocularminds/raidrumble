import type { Decision } from '@raidrumble/policy';
import type { DecisionView } from '../model.js';

/** Public overlays get audit identifiers, never execution grants or approval links. */
export function decisionView(decision: Decision, action: string): DecisionView {
  return {
    decisionId: decision.decisionId,
    action,
    verdict: decision.verdict,
    reasonCodes: [...decision.reasonCodes],
    mode: decision.mode,
    source: decision.source,
    ...(decision.dossierId ? { dossierId: decision.dossierId } : {}),
  };
}
