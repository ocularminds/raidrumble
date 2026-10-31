import { defaultPolicy } from '../defaults.js';
import { LocalPolicyGate } from '../local.js';
import type { LocalPolicyOptions, PolicyConfig } from '../models.js';
import { evaluateDecionis } from './mapping.js';

export interface DecionisOptions extends Omit<LocalPolicyOptions, 'evaluate'> {
  apiBase?: string;
  gatewayUrl?: string;
  apiKey?: string;
}

/** Until the wire mapping is verified, all actions use their explicit local failure rule. */
export class DecionisGate extends LocalPolicyGate {
  constructor(config: PolicyConfig = defaultPolicy(), options: DecionisOptions = {}) {
    super(config, { ...options, evaluate: evaluateDecionis });
  }
}
