import { record, text, uuid } from './shape.js';

export interface PolicySelection {
  /** Named policy slug or the immutable bundle UUID returned by publication. */
  policyId?: string;
  policyVersion?: string;
}

const revision = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Selectors are part of the intent, never an unbound request header. */
export class PolicySelector {
  readonly policyId?: string;
  readonly policyVersion?: string;

  constructor(options: PolicySelection = {}) {
    if (options.policyId !== undefined) {
      const id = text(options.policyId, 100).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) throw new Error('Invalid policy ID');
      this.policyId = id;
    }
    if (options.policyVersion !== undefined) {
      const version = text(options.policyVersion, 100).trim();
      if (!this.policyId || !version) throw new Error('Policy version requires a policy ID');
      this.policyVersion = version;
    }
  }

  parameters(): Record<string, string> {
    return {
      ...(this.policyId ? { policy_id: this.policyId } : {}),
      ...(this.policyVersion ? { policy_version: this.policyVersion } : {}),
    };
  }

  protocol(): Record<string, unknown> {
    return {
      ...this.parameters(),
      ...(this.policyVersion ? { require_exact_policy_version: true } : {}),
    };
  }

  verify(body: Record<string, unknown>, protocol = false): void {
    if (!this.policyId) return;
    if (this.policyVersion && body.policy_version !== this.policyVersion)
      throw new Error('POLICY_ERROR');
    if (!protocol) return;
    const snapshot = record(body.policy_snapshot);
    const id = uuid(snapshot.policy_bundle_id);
    if (
      snapshot.source !== 'org_policy_bundle' ||
      (revision.test(this.policyId) && id.toLowerCase() !== this.policyId)
    )
      throw new Error('POLICY_ERROR');
  }

  static captured(parameters: Record<string, unknown>): PolicySelector {
    return new PolicySelector({
      ...(parameters.policy_id === undefined ? {} : { policyId: text(parameters.policy_id) }),
      ...(parameters.policy_version === undefined
        ? {}
        : { policyVersion: text(parameters.policy_version) }),
    });
  }
}
