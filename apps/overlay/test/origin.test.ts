import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function endpoint(production: boolean, configured?: string) {
  vi.resetModules();
  vi.stubEnv('PROD', production);
  vi.stubEnv('VITE_API_URL', configured);
  vi.stubGlobal('location', { origin: 'https://raids.decionis.com' });
  return (await import('../src/origin.js')).socketEndpoint;
}

describe('overlay deployment WebSocket origin', () => {
  it('uses secure same-origin sockets for host and mirror routes', async () => {
    const socket = await endpoint(true);
    expect(socket('/ws/host').href).toBe('wss://raids.decionis.com/ws/host');
    expect(socket('/ws/mirror/match').href).toBe('wss://raids.decionis.com/ws/mirror/match');
  });

  it('retains the local API socket in development', async () => {
    const socket = await endpoint(false);
    expect(socket('/ws/demo').href).toBe('ws://localhost:3000/ws/demo');
  });

  it('honors an explicit API origin while choosing the correct WebSocket protocol', async () => {
    const socket = await endpoint(true, 'https://api.example.test');
    expect(socket('/ws/demo').href).toBe('wss://api.example.test/ws/demo');
  });
});
