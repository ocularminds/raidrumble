import { describe, expect, it, vi } from 'vitest';
import { HelixReader, TwitchHttpError } from '../src/read.js';

const user = {
  id: '1',
  login: 'garden',
  display_name: 'Garden',
  created_at: '2020-01-01T00:00:00Z',
  broadcaster_type: 'affiliate',
};

describe('HelixReader', () => {
  it('reads users with repeated encoded IDs and credential headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [user] }));
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'secret',
      fetch: fetcher,
    });
    expect(await reader.users(['1', '2'])).toEqual([user]);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.twitch.tv/helix/users?id=1&id=2');
    expect(options?.method).toBe('GET');
    expect(options?.headers).toEqual({ 'Client-Id': 'client', Authorization: 'Bearer secret' });
  });

  it('retains chatter pagination and requests the largest allowed page', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ user_id: '7', user_login: 'seven', user_name: 'Seven' }],
        total: 300,
        pagination: { cursor: 'next' },
      }),
    );
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'token',
      fetch: fetcher,
    });
    const page = await reader.chatters('host', 'mod', 'before');
    expect(page).toMatchObject({ cursor: 'next', total: 300, data: [{ user_id: '7' }] });
    expect(String(fetcher.mock.calls[0]![0])).toContain(
      'broadcaster_id=host&moderator_id=mod&first=1000&after=before',
    );
  });

  it('checks a followed channel without fetching a whole follows list', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [], pagination: {}, total: 0 }));
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'token',
      fetch: fetcher,
    });
    expect(await reader.follows('host', 'raider')).toBe(false);
    expect(String(fetcher.mock.calls[0]![0])).toContain('user_id=host&broadcaster_id=raider');
  });

  it('rejects malformed upstream data rather than trusting an assertion', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 123 }] }));
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'token',
      fetch: fetcher,
    });
    await expect(reader.users(['1'])).rejects.toThrow('Invalid Twitch user');
  });

  it('reports HTTP status and rate limit delay without reflecting secrets', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('secret response', { status: 429, headers: { 'Retry-After': '5' } }),
      );
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'secret',
      fetch: fetcher,
    });
    await expect(reader.users(['1'])).rejects.toMatchObject({ status: 429, retryAfterMs: 5000 });
    try {
      await reader.users(['1']);
    } catch (error) {
      expect(error).toBeInstanceOf(TwitchHttpError);
      expect(String(error)).not.toContain('secret');
    }
  });

  it('avoids requests for empty ID batches and rejects oversized batches', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const reader = new HelixReader({
      clientId: 'client',
      accessToken: () => 'token',
      fetch: fetcher,
    });
    expect(await reader.users([])).toEqual([]);
    await expect(
      reader.users(Array.from({ length: 101 }, (_, index) => String(index))),
    ).rejects.toThrow('100');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
