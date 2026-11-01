import { actionNames, type ActionName } from '../../packages/policy/src/models.js';
import { defaultPolicy } from '../../packages/policy/src/defaults.js';

interface Predicate {
  field: string;
  operator: 'EQ' | 'IN' | 'CONTAINS';
  value?: string | number | boolean;
  values?: boolean[];
}

interface PublishedRule {
  rule_id: string;
  name: string;
  decision_domain: '*';
  when: { all: Predicate[] };
  then: { action: 'AUTO_APPROVE' | 'AUTO_REJECT' | 'ESCALATE'; severity: 'routine' | 'elevated' };
  priority: number;
  enabled: true;
  rationale: string;
}

export interface PublishedBundle {
  protocol_version: '1.0';
  bundle_id: string;
  policy_id: 'raidrumble';
  org_id: string;
  version: 'raidrumble-v1';
  effective_from: string;
  rules: PublishedRule[];
  required_signals: string[];
  metadata: { author: string; source: string; change_ticket: string };
}

const path = 'context.raidrumble.';
const eq = (field: string, value: string | number | boolean): Predicate => ({
  field,
  operator: 'EQ',
  value,
});

function scope(action: ActionName): Predicate[] {
  return [
    eq(`${path}application`, 'raidrumble'),
    eq(`${path}schema`, 1),
    eq('decision_type', action),
    eq(`${path}action`, action),
    { field: `${path}localHostApproved`, operator: 'IN', values: [false, true] },
  ];
}

function rule(
  id: string,
  name: string,
  action: PublishedRule['then']['action'],
  priority: number,
  conditions: Predicate[],
  rationale: string,
): PublishedRule {
  return {
    rule_id: id,
    name,
    decision_domain: '*',
    when: { all: conditions },
    then: { action, severity: action === 'AUTO_APPROVE' ? 'routine' : 'elevated' },
    priority,
    enabled: true,
    rationale,
  };
}

/** Confirmed Protocol bundle DSL; runtime assertions preserve per-host configuration. */
export class RaidRumblePolicy {
  static bundle(orgId: string, bundleId: string, effectiveFrom: string): PublishedBundle {
    const config = defaultPolicy();
    const rules: PublishedRule[] = [
      rule(
        'raidrumble_local_block',
        'Keep local host blocks authoritative',
        'AUTO_REJECT',
        1000,
        [eq(`${path}application`, 'raidrumble'), eq(`${path}localVerdict`, 'BLOCK')],
        'A local block cannot be overridden by a host click or remote allow.',
      ),
      rule(
        'raidrumble_local_hold',
        'Hold unresolved local host decisions',
        'ESCALATE',
        700,
        [
          eq(`${path}application`, 'raidrumble'),
          eq(`${path}localVerdict`, 'ESCALATE'),
          eq(`${path}localHostApproved`, false),
        ],
        'Only an authenticated, exact local host approval may resolve this prerequisite. This assertion is not Decionis Presence evidence.',
      ),
    ];
    for (const action of actionNames) {
      const policy = config.actions[action];
      const id = action.replaceAll('.', '_');
      const reason = (code: string): Predicate => ({
        field: `${path}localReasonCodes`,
        operator: 'CONTAINS',
        value: code,
      });
      for (const blocked of policy.block) {
        rules.push(
          rule(
            `raidrumble_${id}_${blocked.reason.toLowerCase()}`,
            `${action}: ${blocked.reason}`,
            'AUTO_REJECT',
            1100,
            [...scope(action), reason(blocked.reason)],
            `The authenticated runtime evaluated ${blocked.when} using this host's settings; its block remains authoritative.`,
          ),
        );
      }
      const allowed = policy.allow.map((entry) => ({ code: entry.reason, approved: false }));
      if (policy.otherwise.verdict === 'ALLOW')
        allowed.push({ code: policy.otherwise.reason, approved: false });
      if (policy.otherwise.verdict === 'ESCALATE') {
        allowed.push({ code: policy.otherwise.reason, approved: true });
        for (const hold of policy.escalate ?? [])
          allowed.push({ code: hold.reason, approved: true });
      }
      for (const entry of allowed) {
        rules.push(
          rule(
            `raidrumble_${id}_${entry.code.toLowerCase()}`,
            `${action}: ${entry.code}`,
            'AUTO_APPROVE',
            500,
            [
              ...scope(action),
              eq(`${path}localVerdict`, entry.approved ? 'ESCALATE' : 'ALLOW'),
              reason(entry.code),
              ...(entry.approved ? [eq(`${path}localHostApproved`, true)] : []),
            ],
            entry.approved
              ? 'The trusted RaidRumble runtime authenticated the host for this one local decision. Hosted managed approval, grant claiming, expiry and receipts remain separate controls.'
              : 'Only this named action may proceed after its local host prerequisites pass. Runtime facts do not claim independent Twitch or Presence verification by Decionis.',
          ),
        );
      }
    }
    rules.push(
      rule(
        'raidrumble_unrecognized',
        'Reject unsupported actions or assertions',
        'AUTO_REJECT',
        0,
        [],
        'No catch-all ALLOW: an unknown application, action or local result is refused.',
      ),
    );
    return {
      protocol_version: '1.0',
      bundle_id: bundleId,
      policy_id: 'raidrumble',
      org_id: orgId,
      version: 'raidrumble-v1',
      effective_from: effectiveFrom,
      rules,
      required_signals: [
        'application',
        'schema',
        'action',
        'localVerdict',
        'localReasonCodes[0]',
        'localHostApproved',
      ].map((field) => `${path}${field}`),
      metadata: {
        author: 'RaidRumble',
        source: 'raidrumble_local_prerequisites',
        change_ticket: 'T32',
      },
    };
  }
}
