import { describe, expect, it } from 'vitest';
import { streamFixture } from './streamfixture.js';

describe('Gated live match announcements', () => {
  it('announces once, expires controls, then sends one end-of-match shoutout', async () => {
    const f = streamFixture();
    await f.start();
    await Promise.all([f.actions.step(), f.actions.step(), f.actions.step()]);
    const announcements = f.calls.filter((call) => call.url.pathname.endsWith('/chat/messages'));
    expect(announcements).toHaveLength(1);
    expect(JSON.parse(String(announcements[0]!.init?.body))).toMatchObject({
      broadcaster_id: '10',
      sender_id: '20',
    });
    expect(JSON.parse(String(announcements[0]!.init?.body)).message).toContain('/warlord/link1');
    expect(
      f.rooms
        .get('10')
        .gate.listRecords()
        .some((record) => record.action === 'chat.send'),
    ).toBe(true);
    f.advance(180_000);
    await Promise.all([f.actions.step(), f.actions.step()]);
    expect(f.links.size).toBe(0);
    expect(f.live.clearRoster).toHaveBeenCalledWith('30');
    expect(f.calls.filter((call) => call.url.pathname.endsWith('/chat/shoutouts'))).toHaveLength(1);
    await f.app.close();
  });

  it('enforces the one-hour pair shoutout limit even while that policy action is shadowed', async () => {
    const f = streamFixture();
    await f.start();
    await f.actions.step();
    f.advance(180_000);
    await f.actions.step();
    f.rooms.get('10').reset();
    await f.start();
    await f.actions.step();
    f.advance(180_000);
    await f.actions.step();
    expect(f.calls.filter((call) => call.url.pathname.endsWith('/chat/shoutouts'))).toHaveLength(1);
    expect(
      f.rooms
        .get('10')
        .gate.listRecords()
        .some((record) => record.reasonCodes.includes('SHOUTOUT_RATE_LIMIT')),
    ).toBe(true);
    await f.app.close();
  });

  it('never calls Twitch for a whole simulated match', async () => {
    const f = streamFixture();
    await f.rooms.demo('normal');
    await f.actions.step();
    f.advance(180_000);
    await f.actions.step();
    expect(f.calls).toHaveLength(0);
    await f.app.close();
  });
});
