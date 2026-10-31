import type { IncomingMessage, ServerResponse } from 'node:http';

/** Shared by local callback listeners. No upstream request or URL logging occurs. */
export class CallbackRedirect {
  private readonly paths: Set<string>;
  constructor(
    private readonly options: { paths: readonly string[]; authority: string; target: string },
  ) {
    this.paths = new Set(options.paths);
  }

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const path = request.url?.split('?')[0] ?? '';
    if (!this.paths.has(path)) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const reject = (status: number) => {
      response.writeHead(status);
      response.end();
      return true;
    };
    if (request.headers.host?.toLowerCase() !== this.options.authority.toLowerCase())
      return reject(400);
    if (!request.url || request.url.length > 8192) return reject(414);
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return reject(405);
    }
    try {
      const query = new URL(request.url, this.options.target).searchParams;
      const target = new URL(this.options.target);
      for (const key of ['state', 'code', 'error']) {
        const values = query.getAll(key);
        if (values.length > 1) return reject(400);
        if (values[0] !== undefined) target.searchParams.set(key, values[0]);
      }
      response.writeHead(302, { Location: target.toString() });
      response.end();
      return true;
    } catch {
      return reject(400);
    }
  }
}
