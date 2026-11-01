import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerStatic } from '../src/static.js';

const fixtures: { app: FastifyInstance; root: string }[] = [];

async function fixture(built = true) {
  const root = await mkdtemp(join(tmpdir(), 'raidrumble'));
  const app = Fastify();
  fixtures.push({ app, root });
  if (built) {
    for (const name of ['dashboard', 'overlay']) {
      const directory = join(root, 'apps', name, 'dist');
      await mkdir(join(directory, 'assets', name), { recursive: true });
      await writeFile(
        join(directory, 'index.html'),
        `<!doctype html><title>${name}</title><script src="/assets/${name}/entry.js"></script>`,
      );
      await writeFile(join(directory, 'assets', name, 'entry.js'), `window.surface='${name}';`);
    }
    await writeFile(join(root, '.env'), 'private fixture marker');
  }
  return { app, root };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const { app, root } of fixtures.splice(0)) {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

describe('production frontend hosting', () => {
  it('serves both page entry points and all direct links from one origin', async () => {
    const { app, root } = await fixture();
    await registerStatic(app, { enabled: true, root });
    for (const [url, title] of [
      ['/', 'dashboard'],
      ['/warlord/token', 'dashboard'],
      ['/overlay/host?preview=1', 'overlay'],
      ['/mirror/match', 'overlay'],
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toContain(`<title>${title}</title>`);
    }
    const head = await app.inject({ method: 'HEAD', url: '/overlay/host' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
  });

  it('keeps identically named hashed assets in separate cacheable namespaces', async () => {
    const { app, root } = await fixture();
    await registerStatic(app, { enabled: true, root });
    for (const name of ['dashboard', 'overlay']) {
      const response = await app.inject({ url: `/assets/${name}/entry.js` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('javascript');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(response.body).toBe(`window.surface='${name}';`);
    }
  });

  it('preserves API and OAuth handlers and does not turn unknown paths into an SPA', async () => {
    const { app, root } = await fixture();
    app.get('/api/ping', async () => ({ ok: true }));
    app.get('/auth/callback', async () => 'OAuth callback');
    await registerStatic(app, { enabled: true, root });
    expect((await app.inject('/api/ping')).json()).toEqual({ ok: true });
    expect((await app.inject('/auth/callback')).body).toBe('OAuth callback');
    for (const url of [
      '/api/missing',
      '/auth/missing',
      '/assets/dashboard/missing.js',
      '/.env',
      '/apps/server/src/main.ts',
      '/assets/overlay/../../.env',
    ]) {
      const response = await app.inject(url);
      expect([400, 404]).toContain(response.statusCode);
      expect(response.body).not.toContain('private fixture marker');
      expect(response.body).not.toContain('<!doctype html>');
    }
  });

  it('keeps development independent of built frontend files', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { app, root } = await fixture(false);
    await registerStatic(app, { root });
    expect((await app.inject('/')).statusCode).toBe(404);
  });

  it('fails production startup clearly when frontend builds are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { app, root } = await fixture(false);
    await expect(registerStatic(app, { root })).rejects.toThrow('Run pnpm build');
  });
});
