import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('saved host choices and trust approval', () => {
  let runtime: Awaited<ReturnType<typeof createApp>>;
  let now = 0;
  beforeEach(async () => {
    now = 0;
    runtime = await createApp({ autoTick: false, quiet: true, openai: false, now: () => now });
    await runtime.app.ready();
  });
  afterEach(async () => {
    await runtime.app.close();
  });

  it('defaults to Lower Third with sound off and persists explicit choices', async () => {
    const room = runtime.rooms.get('demo');
    expect(room.settings()).toMatchObject({ layout: 'lower', sound: false });
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/settings/demo',
      payload: {
        ...room.settings(),
        layout: 'rail',
        sound: true,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(room.view()).toMatchObject({ layout: 'rail', sound: true });
    expect((await runtime.app.inject('/api/status/demo')).json().settings).toMatchObject({
      layout: 'rail',
      sound: true,
    });
  });

  it.each([{ layout: 'wide' }, { sound: 'yes' }])(
    'rejects invalid presentation preferences %j',
    async (input) => {
      const room = runtime.rooms.get('demo');
      expect(
        (
          await runtime.app.inject({
            method: 'POST',
            url: '/api/settings/demo',
            payload: {
              ...room.settings(),
              ...input,
            },
          })
        ).statusCode,
      ).toBe(400);
    },
  );

  it('adds only the server-bound raider after an explicit successful approval', async () => {
    const room = await runtime.rooms.demo('stranger-raid');
    const decisionId = room.view().pending!.decisionId;
    const login = room.gate.getRequest(decisionId)!.payload.raiderLogin;
    const saved = vi.spyOn(runtime.rooms, 'save');
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/approve/demo',
      payload: { decisionId, trustNextTime: true },
    });
    expect(response.statusCode).toBe(200);
    expect(room.settings().allow).toContain(login);
    expect(saved).toHaveBeenCalledWith('demo');
    expect(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/approve/demo',
          payload: { decisionId, trustNextTime: true },
        })
      ).statusCode,
    ).toBe(409);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('preserves concurrent edits when adding the newly trusted channel', async () => {
    const room = await runtime.rooms.demo('stranger-raid');
    const decisionId = room.view().pending!.decisionId;
    const login = room.gate.getRequest(decisionId)!.payload.raiderLogin;
    const approve = room.gate.approve.bind(room.gate);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(room.gate, 'approve').mockImplementation(async (...args) => {
      entered();
      await barrier;
      return approve(...args);
    });
    const pending = runtime.app.inject({
      method: 'POST',
      url: '/api/approve/demo',
      payload: { decisionId, trustNextTime: true },
    });
    await started;
    room.configure({
      ...room.settings(),
      allow: ['anotherfriend'],
      block: ['anotherblock'],
      blockedTerms: ['private'],
      layout: 'rail',
      sound: true,
    });
    release();
    expect((await pending).statusCode).toBe(200);
    expect(room.settings()).toMatchObject({
      allow: ['anotherfriend', login],
      block: ['anotherblock'],
      blockedTerms: ['private'],
      layout: 'rail',
      sound: true,
    });
  });

  it.each(['omitted', 'expired', 'held', 'invalid'])(
    'does not persist trust for an %s choice or response',
    async (condition) => {
      const room = await runtime.rooms.demo('stranger-raid');
      const decisionId = room.view().pending!.decisionId;
      const before = room.settings().allow;
      if (condition === 'expired') now += 10001;
      if (condition === 'held')
        vi.spyOn(room.gate, 'approve').mockResolvedValue({
          ...room.gate.getDecision(decisionId)!,
          source: 'decionis',
        });
      const payload = {
        decisionId,
        ...(condition === 'omitted'
          ? {}
          : { trustNextTime: condition === 'invalid' ? 'yes' : true }),
      };
      const response = await runtime.app.inject({
        method: 'POST',
        url: '/api/approve/demo',
        payload,
      });
      expect(response.statusCode).toBe(
        condition === 'omitted'
          ? 200
          : condition === 'held'
            ? 202
            : condition === 'invalid'
              ? 400
              : 409,
      );
      expect(room.settings().allow).toEqual(before);
    },
  );
});
