import type { PolicyMode } from '../models.js';
import type { DecionisOptions } from './models.js';
import { AuthorityFailure } from './errors.js';

/** Credentialed calls target the authority API, never the AgentSafe tenant proxy. */
export class DecionisTransport {
  constructor(private readonly options: DecionisOptions) {}

  async request(
    path: string,
    mode: PolicyMode,
    budgetMs: number,
    body?: unknown,
    id?: string,
  ): Promise<unknown> {
    if (!Number.isFinite(budgetMs) || budgetMs <= 0)
      throw new AuthorityFailure('unavailable', true);
    const base = new URL(this.options.apiBase ?? 'https://api.decionis.com');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (
      (base.protocol !== 'https:' && !(loopback && base.protocol === 'http:')) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/' ||
      base.hostname === 'decionisedge.com' ||
      base.hostname.endsWith('.decionisedge.com')
    )
      throw new Error('POLICY_ERROR');
    const key =
      mode === 'enforce'
        ? (this.options.enforceApiKey ?? this.options.apiKey)
        : this.options.apiKey;
    if (!key || /[\r\n]/.test(key)) throw new Error('POLICY_ERROR');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async (): Promise<unknown> => {
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(new URL(path, base), {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'User-Agent': 'RaidRumble/0.1.0',
            ...(id === undefined ? {} : { 'Idempotency-Key': id }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        throw new AuthorityFailure('unavailable');
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new AuthorityFailure(response.status >= 500 ? 'unavailable' : 'refused');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('POLICY_ERROR');
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch {
          throw new AuthorityFailure('unavailable');
        }
        if (next.done) break;
        bytes += next.value.length;
        if (bytes > 256 * 1024) {
          void reader.cancel().catch(() => undefined);
          throw new Error('POLICY_ERROR');
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    };
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              reject(new AuthorityFailure('unavailable', true));
              controller.abort();
            },
            Math.max(1, Math.min(1500, budgetMs)),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
