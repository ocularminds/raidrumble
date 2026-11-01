import { fastifyStatic } from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StaticOptions {
  enabled?: boolean;
  root?: string;
}

/** Hosts authored frontend builds without intercepting API, OAuth, or WebSocket routes. */
export async function registerStatic(
  app: FastifyInstance,
  options: StaticOptions = {},
): Promise<void> {
  if (!(options.enabled ?? process.env.NODE_ENV === 'production')) return;
  const root = options.root ?? fileURLToPath(new URL('../../../', import.meta.url));
  const pages = await Promise.all(
    ['dashboard', 'overlay'].map(async (name) => {
      const directory = join(root, 'apps', name, 'dist');
      const assets = join(directory, 'assets', name);
      try {
        const [html, directoryInfo] = await Promise.all([
          readFile(join(directory, 'index.html'), 'utf8'),
          stat(assets),
        ]);
        if (!directoryInfo.isDirectory()) throw new Error();
        return { name, html, assets };
      } catch {
        throw new Error('Production frontend assets are missing. Run pnpm build first.');
      }
    }),
  );

  for (const { name, html, assets } of pages) {
    await app.register(fastifyStatic, {
      root: assets,
      prefix: `/assets/${name}/`,
      decorateReply: false,
      index: false,
      dotfiles: 'deny',
      immutable: true,
      maxAge: '1y',
    });
    const paths =
      name === 'dashboard' ? ['/', '/warlord/:token'] : ['/overlay/:hostId', '/mirror/:matchId'];
    for (const path of paths)
      app.get(path, async (_request, reply) =>
        reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(html),
      );
  }
}
