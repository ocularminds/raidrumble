import { describe, expect, it, vi } from 'vitest';
import { streamFixture } from './streamfixture.js';

function messages(f: ReturnType<typeof streamFixture>): string[] {
  return f.calls
    .filter((call) => call.url.pathname.endsWith('/chat/messages'))
    .map((call) => String((JSON.parse(String(call.init?.body)) as { message: string }).message));
}

describe('Community chat onboarding and follow invitation', () => {
  it('identifies both communities and their controls, then closes once with a mutual invitation', async () => {
    const f = streamFixture();
    await f.start();
    await f.actions.step();
    expect(messages(f)[0]).toContain("Speed's Raiders ▲ vs Garden's Home Guard ●");
    expect(messages(f)[0]).toContain('3 rounds, 3 minutes');
    expect(messages(f)[0]).toContain('!join raiders / !join home');
    expect(messages(f)[0]).toContain('/warlord/link1');
    f.advance(180_000);
    await Promise.all([f.actions.step(), f.actions.step()]);
    expect(messages(f)).toHaveLength(2);
    expect(messages(f)[1]).toContain('▲ Raiders: follow Garden · ● Home Guard: check out Speed');
    expect(messages(f).every((message) => message.length <= 500)).toBe(true);
    const decisions = f.rooms
      .get('10')
      .gate.listRecords()
      .filter((item) => item.action === 'chat.send');
    expect(decisions).toHaveLength(2);
    await f.app.close();
  });

  it('skips a closing chat blocked by policy without suppressing the match or shoutout', async () => {
    const f = streamFixture();
    await f.start();
    await f.actions.step();
    const gate = f.rooms.get('10').gate;
    gate.setMode('chat.send', 'enforce');
    const authorize = gate.authorize.bind(gate);
    vi.spyOn(gate, 'authorize').mockImplementation(async (request) => {
      const decision = await authorize(request);
      return request.action === 'chat.send' ? { ...decision, verdict: 'BLOCK' } : decision;
    });
    f.advance(180_000);
    await f.actions.step();
    expect(messages(f)).toHaveLength(1);
    expect(f.rooms.get('10').view().match?.status).toBe('finished');
    expect(f.calls.filter((call) => call.url.pathname.endsWith('/chat/shoutouts'))).toHaveLength(1);
    await f.app.close();
  });

  it('never splits a long Warlord URL or sends an overlong opening message', async () => {
    const f = streamFixture();
    vi.spyOn(f.live, 'warlordLink').mockReturnValue({
      token: 'long',
      url: `https://example.com/${'x'.repeat(450)}`,
      loginUrl: '',
    });
    await f.start();
    await f.actions.step();
    expect(messages(f)).toEqual([]);
    f.advance(180_000);
    await f.actions.step();
    expect(messages(f)).toHaveLength(1);
    expect(messages(f)[0]!.length).toBeLessThanOrEqual(500);
    await f.app.close();
  });

  it('keeps the five-second chat limit across an immediate rematch', async () => {
    const f = streamFixture();
    await f.start();
    await f.actions.step();
    f.advance(180_000);
    await f.actions.step();
    f.rooms.get('10').reset();
    await f.start();
    await f.actions.step();
    expect(messages(f)).toHaveLength(2);
    await f.app.close();
  });
});
