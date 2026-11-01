import { LocalPolicyGate, type ActionRequest, type GrantOutcome } from '@raidrumble/policy';
import { vi } from 'vitest';
import { fixture } from './fixture.js';

export function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A real issuance registry with a mocked authority's exclusive channel claim scope. */
export class SetupGate extends LocalPolicyGate {
  readonly authorized: { request: ActionRequest; atMs: number }[] = [];
  readonly outcomes: GrantOutcome[] = [];
  readonly entered = deferred();
  readonly release = deferred();
  busy = 0;
  private held = false;
  private readonly channels = new Map<string, string>();
  private readonly active = new Set<string>();

  constructor(private readonly clock: { now: number }) {
    super(undefined, {
      now: () => clock.now,
      logger: () => undefined,
      evaluate: () => ({ verdict: 'ESCALATE', reasonCodes: ['TEST_APPROVAL'] }),
    });
    this.setMode('events.subscribe', 'enforce');
  }

  override async authorize(request: ActionRequest) {
    this.authorized.push({ request: structuredClone(request), atMs: this.clock.now });
    const held = await super.authorize(request);
    const approved = await super.approve(held.decisionId, request.channel.hostId);
    this.channels.set(approved.grant!.id, request.channel.hostId);
    return approved;
  }

  override async claimGrant(id: string): Promise<boolean> {
    const channel = this.channels.get(id)!;
    if (this.active.has(channel)) {
      this.busy++;
      return false;
    }
    this.active.add(channel);
    const claimed = await super.claimGrant(id);
    if (!claimed) this.active.delete(channel);
    return claimed;
  }

  async finalizeGrant(id: string, outcome: GrantOutcome): Promise<boolean> {
    const channel = this.channels.get(id)!;
    this.outcomes.push(outcome);
    try {
      if (channel === '10' && !this.held) {
        this.held = true;
        this.entered.resolve();
        await this.release.promise;
      }
      return true;
    } finally {
      this.active.delete(channel);
    }
  }
}

export function setupFixture() {
  const clock = { now: 1_798_000_000_000 };
  const gate = new SetupGate(clock);
  const f = fixture({ botUserId: '10', now: () => clock.now, getGate: () => gate });
  return { ...f, gate, clock };
}

export function writes(f: ReturnType<typeof setupFixture>) {
  return f.fetcher.mock.calls
    .filter(([url]) => String(url).includes('/helix/eventsub'))
    .map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          type: string;
          condition: { broadcaster_user_id?: string; to_broadcaster_user_id?: string };
          transport: { session_id: string };
        },
    );
}

export async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export function failFirstWrite(f: ReturnType<typeof setupFixture>) {
  const original = f.fetcher.getMockImplementation()!;
  let failed = false;
  f.fetcher.mockImplementation(async (input, init) => {
    if (String(input).includes('/helix/eventsub') && !failed) {
      failed = true;
      throw new Error('private downstream error');
    }
    return original(input, init);
  });
  return vi.spyOn(f.gate, 'authorize');
}
