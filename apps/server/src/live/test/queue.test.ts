import { describe, expect, it } from 'vitest';
import { ChannelQueue } from '../queue.js';
import { deferred } from './setup.js';

describe('channel queue cleanup', () => {
  it.each(['throw', 'reject'] as const)(
    'releases a channel after an operation %s',
    async (kind) => {
      const queue = new ChannelQueue();
      const first = queue.run('host', () => {
        if (kind === 'throw') throw new Error('expected');
        return Promise.reject(new Error('expected'));
      });
      const next = queue.run('host', () => 42);
      await expect(first).rejects.toThrow('expected');
      await expect(next).resolves.toBe(42);
      await expect(queue.run('host', () => 'reused')).resolves.toBe('reused');
    },
  );

  it('does not remove a newer queued operation while the previous one finishes', async () => {
    const queue = new ChannelQueue();
    const entered = deferred();
    const release = deferred();
    const order: number[] = [];
    await queue.run('host', () => order.push(1));
    const second = queue.run('host', async () => {
      entered.resolve();
      await release.promise;
      order.push(2);
    });
    await entered.promise;
    const third = queue.run('host', () => order.push(3));
    await queue.run('other', () => order.push(0));
    expect(order).toEqual([1, 0]);
    release.resolve();
    await Promise.all([second, third]);
    expect(order).toEqual([1, 0, 2, 3]);
  });
});
