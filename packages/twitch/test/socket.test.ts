import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSubClient } from '../src/eventsub.js';
import type { EventSocket } from '../src/socket.js';

class FakeSocket implements EventSocket {
  message: (data: string) => void = () => undefined;
  closed: (code: number) => void = () => undefined;
  error: (error: Error) => void = () => undefined;
  close = vi.fn();
  onMessage(listener: (data: string) => void): void {
    this.message = listener;
  }
  onClose(listener: (code: number) => void): void {
    this.closed = listener;
  }
  onError(listener: (error: Error) => void): void {
    this.error = listener;
  }
  emit(type: string, payload: unknown, id = `id-${type}`): void {
    this.message(
      JSON.stringify({
        metadata: { message_id: id, message_type: type, message_timestamp: '2026-10-31T10:00:00Z' },
        payload,
      }),
    );
  }
  welcome(id = 'session'): void {
    this.emit('session_welcome', { session: { id, keepalive_timeout_seconds: 10 } }, id);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const onSession = vi.fn();
  const onNotification = vi.fn();
  const onRevocation = vi.fn();
  const onError = vi.fn();
  const client = new EventSubClient({
    onSession,
    onNotification,
    onRevocation,
    onError,
    createSocket: (url) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      urls.push(url);
      return socket;
    },
  });
  client.start();
  return { client, sockets, urls, onSession, onNotification, onRevocation, onError };
}

const raid = {
  subscription: { id: 'sub1', type: 'channel.raid', version: '1', status: 'enabled' },
  event: {
    from_broadcaster_user_id: 'raider',
    from_broadcaster_user_login: 'raid',
    from_broadcaster_user_name: 'Raid',
    to_broadcaster_user_id: 'host',
    to_broadcaster_user_login: 'home',
    to_broadcaster_user_name: 'Home',
    viewers: 300,
  },
};

describe('EventSubClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('reports fresh sessions and deduplicates event IDs', async () => {
    const { client, sockets, onSession, onNotification } = setup();
    sockets[0]!.welcome();
    sockets[0]!.emit('notification', raid, 'raid1');
    sockets[0]!.emit('notification', raid, 'raid1');
    await vi.advanceTimersByTimeAsync(0);
    expect(onSession).toHaveBeenCalledWith('session', { reconnected: false });
    expect(onNotification).toHaveBeenCalledOnce();
    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'raid', hostId: 'host', raiderId: 'raider', viewers: 300 }),
    );
    expect(client.status).toBe('connected');
    client.stop();
  });

  it('preserves the old socket until a migration welcomes the new connection', async () => {
    const { client, sockets, urls, onSession } = setup();
    sockets[0]!.welcome('original');
    sockets[0]!.emit('session_reconnect', {
      session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=opaque' },
    });
    expect(urls[1]).toContain('reconnect=opaque');
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    sockets[1]!.welcome('migrated');
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    expect(onSession).toHaveBeenLastCalledWith('migrated', { reconnected: true });
    client.stop();
  });

  it('reconnects and asks to resubscribe after the keepalive deadline', async () => {
    const { client, sockets, onSession } = setup();
    sockets[0]!.welcome();
    await vi.advanceTimersByTimeAsync(9_000);
    sockets[0]!.emit('session_keepalive', {}, 'keepalive');
    await vi.advanceTimersByTimeAsync(9_000);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(sockets).toHaveLength(2);
    sockets[1]!.welcome('new');
    await vi.advanceTimersByTimeAsync(0);
    expect(onSession).toHaveBeenLastCalledWith('new', { reconnected: false });
    client.stop();
  });

  it('recovers from a close and ignores obsolete socket callbacks', async () => {
    const { client, sockets, onNotification } = setup();
    sockets[0]!.welcome();
    sockets[0]!.closed(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1]!.welcome('new');
    sockets[0]!.emit('notification', raid);
    await vi.advanceTimersByTimeAsync(0);
    expect(onNotification).not.toHaveBeenCalled();
    client.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(2);
  });

  it('rejects a reconnect URL on an unrelated server', () => {
    const { client, sockets, onError } = setup();
    sockets[0]!.welcome();
    sockets[0]!.emit('session_reconnect', {
      session: { reconnect_url: 'wss://attacker.invalid/ws' },
    });
    expect(sockets).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
    client.stop();
  });

  it('reports revocation, rejects malformed frames, and continues receiving', async () => {
    const { client, sockets, onError, onRevocation, onNotification } = setup();
    sockets[0]!.welcome();
    sockets[0]!.message('{ invalid');
    sockets[0]!.emit('revocation', {
      subscription: { id: 'sub1', type: 'channel.raid', status: 'authorization_revoked' },
    });
    sockets[0]!.emit('notification', raid);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalled();
    expect(onRevocation).toHaveBeenCalledWith({
      id: 'sub1',
      type: 'channel.raid',
      status: 'authorization_revoked',
    });
    expect(onNotification).toHaveBeenCalledOnce();
    client.stop();
  });

  it('isolates async application callback failures', async () => {
    const { client, sockets, onNotification, onError } = setup();
    onNotification.mockRejectedValue(new Error('application failed'));
    sockets[0]!.welcome();
    sockets[0]!.emit('notification', raid);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'application failed' }),
    );
    expect(client.status).toBe('connected');
    client.stop();
  });
});
