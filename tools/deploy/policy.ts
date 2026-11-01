import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical, record, text, uuid } from '../../packages/policy/src/decionis/shape.js';
import { RaidRumblePolicy, type PublishedBundle } from './rules.js';

interface PublicationOptions {
  apiBase?: string;
  apiKey: string;
  orgId: string;
  fetch?: typeof fetch;
}

interface Publication {
  name: string;
  bundleId: string;
  version: string;
  created: boolean;
  ruleCount: number;
}

interface Revision {
  id: string;
  payload: Record<string, unknown>;
}

/** Uses only the confirmed API-key bundle inventory/publication endpoints. */
export class PolicyPublisher {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: PublicationOptions) {
    const base = new URL(options.apiBase ?? 'https://api.decionis.com');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error('Invalid policy API base');
    uuid(options.orgId);
    text(options.apiKey, 10_000);
    this.origin = base.href.replace(/\/$/, '');
    this.fetcher = options.fetch ?? fetch;
  }

  async inventory(): Promise<Revision[]> {
    const response = await this.request(
      `/v1/protocol/policies/bundles?org_id=${encodeURIComponent(this.options.orgId)}&limit=500`,
    );
    if (!Array.isArray(response.bundles) || response.bundles.length >= 500)
      throw new Error('Policy inventory incomplete');
    return response.bundles.map((entry: unknown) => {
      const row = record(entry);
      return { id: text(row.bundle_id), payload: record(row.payload) };
    });
  }

  async publish(bundle: PublishedBundle): Promise<Publication> {
    if (bundle.policy_id !== 'raidrumble' || bundle.org_id !== this.options.orgId)
      throw new Error('Publication scope mismatch');
    const before = await this.inventory();
    const named = before.filter((entry) => entry.payload.policy_id === 'raidrumble');
    if (named.length) {
      if (named.length !== 1 || !this.same(named[0]!.payload, bundle))
        throw new Error('Existing named policy differs; explicit revision review required');
      return this.summary(bundle, named[0]!.id, false);
    }
    const accepted = await this.request('/v1/protocol/policies/bundles', bundle);
    if (
      accepted.accepted !== true ||
      accepted.artifact !== 'policy_bundle' ||
      accepted.artifact_id !== bundle.bundle_id
    )
      throw new Error('Publication receipt mismatch; inspect inventory before retrying');
    const after = await this.inventory();
    const saved = after.find((entry) => entry.id === bundle.bundle_id);
    if (!saved || !this.same(saved.payload, bundle))
      throw new Error('Published policy readback mismatch');
    for (const entry of before) {
      const current = after.find((item) => item.id === entry.id);
      if (!current || canonical(current.payload) !== canonical(entry.payload))
        throw new Error('Unrelated policy inventory changed');
    }
    return this.summary(bundle, bundle.bundle_id, true);
  }

  private same(existing: Record<string, unknown>, proposed: PublishedBundle): boolean {
    return ['policy_id', 'org_id', 'version', 'rules', 'required_signals', 'metadata'].every(
      (key) => canonical(existing[key]) === canonical(record(proposed)[key]),
    );
  }

  private summary(bundle: PublishedBundle, bundleId: string, created: boolean): Publication {
    return {
      name: bundle.policy_id,
      bundleId,
      version: bundle.version,
      created,
      ruleCount: bundle.rules.length,
    };
  }

  private async request(path: string, body?: PublishedBundle): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'RaidRumble/0.1 PolicyPublication',
        ...(body ? { 'idempotency-key': body.bundle_id } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Policy API HTTP ${response.status}; inspect safely before retrying`);
    }
    return record(await response.json());
  }
}

async function main(): Promise<void> {
  if (process.argv[2] !== '--publish') throw new Error('Explicit --publish is required');
  const apiKey = process.env.DECIONIS_POLICY_API_KEY;
  const orgId = process.env.DECIONIS_ORG_ID;
  if (!apiKey || !orgId) throw new Error('Policy administration credentials are required');
  await mkdir('artifacts/deploy', { recursive: true, mode: 0o700 });
  const publisher = new PolicyPublisher({ apiKey, orgId, apiBase: process.env.DECIONIS_API_BASE });
  const bundle = RaidRumblePolicy.bundle(orgId, randomUUID(), new Date().toISOString());
  const result = await publisher.publish(bundle);
  await writeFile(
    'artifacts/deploy/policy.json',
    `${JSON.stringify(
      {
        ...result,
        publishedAt: new Date().toISOString(),
        endpoint: '/v1/protocol/policies/bundles',
        unrelatedPoliciesUnchanged: true,
        executionClaims: 0,
        twitchEffects: 0,
      },
      null,
      2,
    )}\n`,
  );
  console.info(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Policy publication failed');
    process.exitCode = 1;
  });
}
