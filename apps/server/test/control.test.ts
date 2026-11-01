import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoChannels } from '@raidrumble/content';
import { createApp } from '../src/app.js';

describe('authenticated real-chat practice controls', () => {
  let runtime: Awaited<ReturnType<typeof createApp>>;
  beforeEach(async () => {
    runtime = await createApp({ autoTick: false, quiet: true, openai: false });
    runtime.rooms.addHost({ ...demoChannels.host, id: 'host' });
    await runtime.app.ready();
  });
  afterEach(async () => {
    await runtime.app.close();
  });
  function login() {
    vi.spyOn(runtime.live, 'authorizeHost').mockImplementation((_request, id) => id === 'host');
  }

  it('requires an actual host session for entry and exit', async () => {
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/test/host',
          payload: { realChat: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await runtime.app.inject({ method: 'POST', url: '/api/practice/host/exit' })).statusCode,
    ).toBe(401);
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/test/demo',
          payload: { realChat: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await runtime.app.inject({ method: 'POST', url: '/api/practice/demo/exit' })).statusCode,
    ).toBe(403);
  });

  it('starts explicitly labeled practice and exits back to the untouched primary room', async () => {
    login();
    const primary = runtime.rooms.primary('host');
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/test/host',
      payload: { realChat: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      practice: 'realchat',
      simulated: true,
      status: 'active',
    });
    expect(runtime.rooms.get('host')).not.toBe(primary);
    const exit = await runtime.app.inject({
      method: 'POST',
      url: '/api/practice/host/exit',
      payload: {},
    });
    expect(exit.statusCode).toBe(200);
    expect(exit.json()).toEqual({ exited: true });
    expect(runtime.rooms.get('host')).toBe(primary);
    expect(primary.view().match).toBeUndefined();
    expect(runtime.ledger.graph().edges).toHaveLength(0);
  });

  it.each([null, true, { realChat: 'yes' }, { realChat: 1 }])(
    'rejects a malformed entry body %j',
    async (payload) => {
      login();
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/test/host',
        payload: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
      expect(runtime.rooms.get('host')).toBe(runtime.rooms.primary('host'));
    },
  );

  it('rejects an exit payload carrying settings or a new identity', async () => {
    login();
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/practice/host/exit',
      payload: { hostId: 'someoneelse' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports an active primary challenge as a conflict instead of replacing it', async () => {
    login();
    await runtime.rooms.raid('host', {
      channels: { ...demoChannels, host: { ...demoChannels.host, id: 'host' } },
      raiderLogin: 'pixelpilot',
      accountAgeDays: 300,
      hostFollowsRaider: true,
      viewers: 5,
    });
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/test/host',
      payload: { realChat: true },
    });
    expect(response.statusCode).toBe(409);
    expect(runtime.rooms.get('host')).toBe(runtime.rooms.primary('host'));
  });

  it('writes host preferences to primary state while keeping practice presentation in sync', async () => {
    login();
    await runtime.rooms.practice('host');
    const settings = { ...runtime.rooms.primary('host').settings(), layout: 'rail', sound: true };
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/settings/host',
      payload: settings,
    });
    expect(response.statusCode).toBe(200);
    expect(runtime.rooms.primary('host').settings()).toMatchObject({ layout: 'rail', sound: true });
    expect(runtime.rooms.get('host').view()).toMatchObject({ layout: 'rail', sound: true });
    const status = (await runtime.app.inject('/api/status/host')).json();
    expect(status.settings).toMatchObject({ layout: 'rail', sound: true });
  });
});
