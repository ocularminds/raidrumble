import { describe, expect, it, vi } from 'vitest';
import { streamFixture } from './streamfixture.js';

describe('Warlord and stream action routes', () => {
  it('runs the demo Warlord only on the simulated demo match', async () => {
    const f = streamFixture();
    await f.rooms.demo('normal');
    await f.actions.step();
    const status = await f.app.inject({ url: '/api/warlord/demo' });
    expect(status.json()).toMatchObject({
      authorized: true,
      active: true,
      available: true,
      simulated: true,
    });
    expect((await f.app.inject({ method: 'POST', url: '/api/warlord/demo' })).json()).toEqual({
      fired: true,
    });
    expect((await f.app.inject({ method: 'POST', url: '/api/warlord/demo' })).statusCode).toBe(409);
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.app.close();
  });

  it('requires Warlord identity and the current match before firing', async () => {
    const f = streamFixture();
    await f.start();
    await f.actions.step();
    const token = [...f.links.keys()][0]!;
    const path = `/api/warlord/${token}`;
    expect((await f.app.inject({ url: path })).json()).toMatchObject({
      authorized: false,
      available: true,
      simulated: false,
    });
    expect(
      (await f.app.inject({ method: 'POST', url: path, payload: { actorId: '30' } })).statusCode,
    ).toBe(401);
    expect(
      (await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '30' } })).json(),
    ).toEqual({ fired: true });
    expect(
      (await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '30' } })).statusCode,
    ).toBe(409);
    f.rooms.get('10').reset();
    await f.start();
    expect(
      (await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '30' } })).statusCode,
    ).toBe(404);
    await f.app.close();
  });

  it('prepares a concrete reward and executes only its approved server-held descriptor', async () => {
    const f = streamFixture();
    const path = '/api/rewards/10';
    expect((await f.app.inject({ method: 'POST', url: path })).statusCode).toBe(401);
    const prepared = await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '10' } });
    const value = prepared.json();
    expect(value).toMatchObject({
      eligible: true,
      reward: { title: 'Reinforcements', cost: 100, skipQueue: true },
      decision: { verdict: 'ESCALATE' },
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const approval = {
      decisionId: value.decision.decisionId,
      write: { body: { cost: 1, title: 'Hacked' } },
    };
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `${path}/approve`,
          headers: { 'x-user': '99' },
          payload: approval,
        })
      ).statusCode,
    ).toBe(401);
    const configured = await f.app.inject({
      method: 'POST',
      url: `${path}/approve`,
      headers: { 'x-user': '10' },
      payload: approval,
    });
    expect(configured.json()).toMatchObject({ configured: true, rewardId: 'reward1' });
    const write = f.calls.find((call) => call.url.pathname.endsWith('/custom_rewards'))!;
    expect(JSON.parse(String(write.init?.body))).toMatchObject({
      title: 'Reinforcements',
      cost: 100,
      should_redemptions_skip_request_queue: true,
    });
    expect(f.rooms.rewardIds.get('10')).toBe('reward1');
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `${path}/approve`,
          headers: { 'x-user': '10' },
          payload: approval,
        })
      ).statusCode,
    ).toBe(409);
    await f.app.close();
  });

  it('rejects reward setup for unverified channel eligibility and expires approvals', async () => {
    const f = streamFixture();
    vi.mocked(f.live.profile).mockReturnValueOnce({ ...f.host, affiliate: false });
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/rewards/10', headers: { 'x-user': '10' } }))
        .statusCode,
    ).toBe(403);
    const prepared = await f.app.inject({
      method: 'POST',
      url: '/api/rewards/10',
      headers: { 'x-user': '10' },
    });
    f.setNow(21_000);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/rewards/10/approve',
          headers: { 'x-user': '10' },
          payload: { decisionId: prepared.json().decision.decisionId },
        })
      ).statusCode,
    ).toBe(409);
    expect(f.fetcher).not.toHaveBeenCalled();
    await f.app.close();
  });

  it('prevents a new reward proposal while a prior approval is being applied', async () => {
    const f = streamFixture();
    const pending = await f.actions.prepareReward('10');
    let release: (() => void) | undefined;
    f.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(Response.json({ data: [{ id: 'reward1' }] }));
        }),
    );
    const applying = f.actions.approveReward('10', '10', pending.decision.decisionId);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(f.actions.prepareReward('10')).rejects.toMatchObject({ statusCode: 409 });
    release!();
    expect(await applying).toMatchObject({ configured: true, rewardId: 'reward1' });
    expect(f.fetcher).toHaveBeenCalledOnce();
    await f.app.close();
  });

  it('starts Collab Rumble only for a verified member of the current Shared Chat', async () => {
    const f = streamFixture();
    const path = '/api/collab/10';
    expect((await f.app.inject({ method: 'POST', url: path })).statusCode).toBe(401);
    expect(
      (await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '10' } })).statusCode,
    ).toBe(409);
    f.rooms.shared.set('10', ['10', '30']);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: path,
          headers: { 'x-user': '10' },
          payload: { peerId: 'attacker' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await f.app.inject({ method: 'POST', url: path, headers: { 'x-user': '10' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'active',
      simulated: false,
      decision: { action: 'rumble.start.collab', verdict: 'ALLOW' },
    });
    expect(f.rooms.get('10').raiderId).toBe('30');
    await f.app.close();
  });

  it('requires choosing a peer in a multi-channel session and fails unknown identity reads', async () => {
    const f = streamFixture();
    f.rooms.shared.set('10', ['10', '30', '40']);
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/collab/10', headers: { 'x-user': '10' } }))
        .statusCode,
    ).toBe(400);
    f.fetcher.mockRejectedValue(new Error('Twitch read failed'));
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/collab/10',
          headers: { 'x-user': '10' },
          payload: { peerId: '30' },
        })
      ).statusCode,
    ).toBe(503);
    expect(f.rooms.get('10').matchId).toBeUndefined();
    await f.app.close();
  });
});
