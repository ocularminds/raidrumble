/** Queue before authorization so each operation receives a fresh policy allowance. */
export class ChannelQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(channelId: string, operation: () => T | Promise<T>): Promise<T> {
    const result = (this.tails.get(channelId) ?? Promise.resolve()).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(channelId, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(channelId) === tail) this.tails.delete(channelId);
    }
  }
}
