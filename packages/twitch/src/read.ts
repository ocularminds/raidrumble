import type { ChannelInfo, Chatter, FollowedChannel, Page, TwitchUser } from './model.js';
import { count, identifier, record, strings, text, timestamp } from './parse.js';

export interface HelixReaderOptions {
  clientId: string;
  accessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class TwitchHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(`Twitch request failed (${status})`);
    this.name = 'TwitchHttpError';
  }
}

export class HelixReader {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: HelixReaderOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  async users(ids: readonly string[]): Promise<TwitchUser[]> {
    if (!ids.length) return [];
    const query = this.batch('id', ids);
    return (await this.read('/users', query, parseUser)).data;
  }

  async channels(ids: readonly string[]): Promise<ChannelInfo[]> {
    if (!ids.length) return [];
    const query = this.batch('broadcaster_id', ids);
    return (await this.read('/channels', query, parseChannel)).data;
  }

  followed(userId: string, after?: string): Promise<Page<FollowedChannel>> {
    const query = new URLSearchParams({ user_id: userId, first: '100' });
    if (after) query.set('after', after);
    return this.read('/channels/followed', query, parseFollow);
  }

  async follows(userId: string, broadcasterId: string): Promise<boolean> {
    const query = new URLSearchParams({ user_id: userId, broadcaster_id: broadcasterId });
    return (await this.read('/channels/followed', query, parseFollow)).data.length > 0;
  }

  chatters(broadcasterId: string, moderatorId: string, after?: string): Promise<Page<Chatter>> {
    const query = new URLSearchParams({
      broadcaster_id: broadcasterId,
      moderator_id: moderatorId,
      first: '1000',
    });
    if (after) query.set('after', after);
    return this.read('/chat/chatters', query, parseChatter);
  }

  private batch(key: string, ids: readonly string[]): URLSearchParams {
    if (ids.length > 100) throw new Error('Twitch batches support at most 100 IDs');
    const query = new URLSearchParams();
    ids.forEach((id) => query.append(key, identifier(id, 'ID')));
    return query;
  }

  private async read<T>(
    path: string,
    query: URLSearchParams,
    parse: (value: unknown) => T,
  ): Promise<Page<T>> {
    const token = await this.options.accessToken();
    const response = await this.fetcher(`https://api.twitch.tv/helix${path}?${query}`, {
      method: 'GET',
      headers: { 'Client-Id': this.options.clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
    });
    if (!response.ok) {
      const delay = Number(response.headers.get('Retry-After'));
      throw new TwitchHttpError(
        response.status,
        delay > 0 && Number.isFinite(delay) ? delay * 1000 : undefined,
      );
    }
    const body = record(await response.json(), 'response');
    if (!Array.isArray(body.data)) throw new Error('Invalid Twitch data');
    const result: Page<T> = { data: body.data.map(parse) };
    if (body.total !== undefined) result.total = count(body.total, 'total');
    if (body.pagination !== undefined) {
      const pagination = record(body.pagination, 'pagination');
      if (pagination.cursor !== undefined) result.cursor = text(pagination.cursor, 'cursor');
    }
    return result;
  }
}

function parseUser(value: unknown): TwitchUser {
  const user = record(value, 'user');
  const createdAt = text(user.created_at, 'user creation date');
  timestamp(createdAt);
  return {
    id: identifier(user.id, 'user ID'),
    login: identifier(user.login, 'user login'),
    display_name: text(user.display_name, 'user display name'),
    created_at: createdAt,
    broadcaster_type: text(user.broadcaster_type, 'user broadcaster type'),
  };
}

function parseChannel(value: unknown): ChannelInfo {
  const channel = record(value, 'channel');
  return {
    broadcaster_id: identifier(channel.broadcaster_id, 'channel ID'),
    broadcaster_login: text(channel.broadcaster_login, 'channel login'),
    broadcaster_name: text(channel.broadcaster_name, 'channel name'),
    title: text(channel.title, 'channel title'),
    game_id: text(channel.game_id, 'category ID'),
    game_name: text(channel.game_name, 'category name'),
    tags: strings(channel.tags, 'channel tags'),
  };
}

function parseFollow(value: unknown): FollowedChannel {
  const follow = record(value, 'follow');
  return {
    broadcaster_id: identifier(follow.broadcaster_id, 'follow ID'),
    broadcaster_login: text(follow.broadcaster_login, 'follow login'),
    broadcaster_name: text(follow.broadcaster_name, 'follow name'),
    followed_at: text(follow.followed_at, 'follow timestamp'),
  };
}

function parseChatter(value: unknown): Chatter {
  const chatter = record(value, 'chatter');
  return {
    user_id: identifier(chatter.user_id, 'chatter ID'),
    user_login: text(chatter.user_login, 'chatter login'),
    user_name: text(chatter.user_name, 'chatter name'),
  };
}
