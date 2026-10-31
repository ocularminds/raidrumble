import { describe, expect, it, vi } from 'vitest';
import { PolicyExecutor } from '../src/executor.js';
import { DecionisGate } from '../src/decionis/gate.js';
import type { HelixWrite, PolicyMode } from '../src/models.js';
import { request, setup } from './helpers.js';

const subscription = {
  type: 'channel.raid',
  version: '1',
  condition: { to_broadcaster_user_id: 'host' },
  transport: { method: 'websocket', session_id: 'session' },
};

describe.each<PolicyMode>(['shadow', 'enforce'])('EventSub setup in %s mode', (mode) => {
  it('checks host identity, event type, channel condition and websocket session', async () => {
    const { gate } = setup(mode);
    const req = request('events.subscribe');
    req.actor = { kind: 'host', twitchUserId: 'host' };
    req.payload = { subscription };
    expect((await gate.authorize(req)).verdict).toBe('ALLOW');
    req.actor.twitchUserId = 'stranger';
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.actor.twitchUserId = 'host';
    req.payload.subscription = { ...subscription, condition: { to_broadcaster_user_id: 'other' } };
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
    req.payload.subscription = { ...subscription, type: 'channel.ban' };
    expect((await gate.authorize(req)).verdict).toBe('BLOCK');
  });
});

describe('Helix executor', () => {
  it('performs the exact gated write and rejects a channel substitution', async () => {
    const { gate } = setup();
    const req = request('events.subscribe');
    req.actor = { kind: 'host', twitchUserId: 'host' };
    req.payload = { subscription };
    const decision = await gate.authorize(req);
    const write: HelixWrite = {
      method: 'POST',
      path: '/eventsub/subscriptions',
      body: subscription,
    };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[]}'));
    const executor = new PolicyExecutor(gate);
    const credentials = { clientId: 'client', accessToken: 'test', fetch: transport };
    expect(
      (
        await executor.executeHelix(
          decision,
          { ...write, body: { ...subscription, type: 'channel.ban' } },
          credentials,
        )
      ).executed,
    ).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(await executor.executeHelix(decision, write, credentials)).toMatchObject({
      executed: true,
      value: { data: [] },
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0].toString()).toBe(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
    );
  });

  it('refuses credential forwarding to arbitrary hosts', async () => {
    const { gate } = setup();
    const req = request('chat.send');
    req.actor = { kind: 'system', twitchUserId: 'bot' };
    req.payload = { templated: true, text: 'Welcome' };
    const decision = await gate.authorize(req);
    const transport = vi.fn<typeof fetch>();
    const result = await new PolicyExecutor(gate).executeHelix(
      decision,
      {
        method: 'POST',
        path: '/chat/messages',
        body: { broadcaster_id: 'host', sender_id: 'bot', message: 'Welcome' },
      },
      {
        clientId: 'client',
        accessToken: 'test',
        fetch: transport,
        apiBase: 'https://example.org/helix',
      },
    );
    expect(result).toMatchObject({ executed: false, reason: 'INVALID_API_BASE' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('uses declared failure defaults without pretending the hosted mapping is implemented', async () => {
    const gate = new DecionisGate(undefined, { logger: () => undefined });
    expect(await gate.authorize(request())).toMatchObject({
      verdict: 'ESCALATE',
      source: 'local',
      reasonCodes: ['POLICY_ERROR'],
    });
  });
});
