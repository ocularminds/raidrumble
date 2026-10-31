import type { DecionisOptions, PolicyMode } from '@raidrumble/policy';

export interface AuthorityConfig {
  gateKind: 'local' | 'decionis';
  initialMode?: PolicyMode;
  decionis?: DecionisOptions;
}

/** Only execution credentials cross this boundary; proxy and policy keys stay separate. */
export function authorityConfig(env: Record<string, string | undefined>): AuthorityConfig {
  if (env.POLICY_GATE !== 'decionis') return { gateKind: 'local' };
  const mode = (env.DECIONIS_MODE ?? 'SHADOW').trim().toUpperCase();
  if (!['SHADOW', 'ENFORCE', 'ENFORCEMENT', 'LIVE'].includes(mode))
    throw new Error('DECIONIS_MODE must be SHADOW or ENFORCEMENT.');
  return {
    gateKind: 'decionis',
    initialMode: mode === 'SHADOW' ? 'shadow' : 'enforce',
    decionis: {
      apiBase: env.DECIONIS_API_BASE ?? 'https://api.decionis.com',
      apiKey: env.DECIONIS_API_KEY,
      enforceApiKey: env.DECIONIS_ENFORCE_API_KEY,
      orgId: env.DECIONIS_ORG_ID,
    },
  };
}
