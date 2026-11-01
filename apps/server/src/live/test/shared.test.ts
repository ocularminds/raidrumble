import { describe, expect, it, vi } from 'vitest';
import type { SharedNotification } from '@raidrumble/twitch';
import { fixture, login } from './fixture.js';

const event: SharedNotification = {
  type: 'shared',
  id: 'shared1',
  occurredAt: 1_798_000_000_000,
  phase: 'begin',
  sessionId: 'session',
  channelId: '10',
  hostBroadcasterId: '10',
  participants: ['10', '30'],
};

describe('Shared Chat display names', () => {
  it('reads names with the bound host and gates them before exposing a copy', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    f.fetcher.mockClear();
    await f.sockets[0]!.options.onNotification(event);
    expect(f.onShared).toHaveBeenCalledWith('10', ['10', '30']);
    expect(f.service.sharedChannels('10')).toEqual([
      { id: '10', name: 'Stream 10' },
      { id: '30', name: 'Stream 30' },
    ]);
    const read = f.fetcher.mock.calls.find(([url]) => String(url).includes('/users'))!;
    expect(new URL(String(read[0])).searchParams.getAll('id')).toEqual(['10', '30']);
    expect(new Headers(read[1]?.headers).get('Authorization')).toBe('Bearer 10:host');
    expect(
      f.gates
        .get('10')!
        .listRecords()
        .filter((item) => item.action === 'content.render'),
    ).toHaveLength(2);
    const copy = f.service.sharedChannels('10');
    copy[0]!.name = 'Changed';
    expect(f.service.sharedChannels('10')[0]!.name).toBe('Stream 10');
    expect(f.service.sharedChannels('other')).toEqual([]);
    await f.app.close();
  });

  it('uses authored labels for blocked names and failed identity reads', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    await f.sockets[0]!.options.onSession('session', { reconnected: false });
    f.gates.get('10')!.updateLists({ blockedTerms: ['Stream 30'] });
    await f.sockets[0]!.options.onNotification(event);
    expect(f.service.sharedChannels('10')).toEqual([
      { id: '10', name: 'Stream 10' },
      { id: '30', name: 'Shared Channel 2' },
    ]);
    f.fetcher.mockRejectedValueOnce(new Error('private downstream body'));
    await f.sockets[0]!.options.onNotification({
      ...event,
      phase: 'update',
      participants: ['10', '40'],
    });
    expect(f.service.sharedChannels('10')).toEqual([
      { id: '10', name: 'Shared Channel 1' },
      { id: '40', name: 'Shared Channel 2' },
    ]);
    expect(f.onError).not.toHaveBeenCalled();
    await f.app.close();
  });

  it('never restores stale names after a newer session end or authorization revocation', async () => {
    const f = fixture();
    await login(f, 'host', '10');
    let finish: ((value: Response) => void) | undefined;
    f.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.sockets[0]!.options.onNotification(event);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await f.sockets[0]!.options.onNotification({ ...event, phase: 'end' });
    finish!(Response.json({ data: [{ id: '30', display_name: 'Old name' }] }));
    await pending;
    expect(f.service.sharedChannels('10')).toEqual([]);
    await f.sockets[0]!.options.onNotification(event);
    await f.sockets[0]!.options.onRevocation?.({
      id: 'subscription',
      type: 'channel.shared_chat.begin',
      status: 'authorization_revoked',
    });
    expect(f.service.sharedChannels('10')).toEqual([]);
    await f.app.close();
  });
});
