import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function origins(production: boolean, api?: string, overlay?: string) {
  vi.resetModules();
  vi.stubEnv('PROD', production);
  vi.stubEnv('VITE_API_URL', api);
  vi.stubEnv('VITE_OVERLAY_URL', overlay);
  vi.stubGlobal('location', { origin: 'https://raids.decionis.com' });
  return import('../src/origin.js');
}

describe('dashboard deployment origins', () => {
  it('uses its current HTTPS origin for production API calls and the overlay iframe', async () => {
    expect(await origins(true)).toMatchObject({
      apiBase: 'https://raids.decionis.com',
      overlayBase: 'https://raids.decionis.com',
    });
  });

  it('retains separate localhost development servers', async () => {
    expect(await origins(false)).toMatchObject({
      apiBase: 'http://localhost:3000',
      overlayBase: 'http://localhost:5173',
    });
  });

  it('honors explicit build-time endpoints', async () => {
    expect(
      await origins(true, 'https://api.example.test', 'https://overlay.example.test'),
    ).toMatchObject({
      apiBase: 'https://api.example.test',
      overlayBase: 'https://overlay.example.test',
    });
  });
});
