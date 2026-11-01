import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const production = process.env.NODE_ENV === 'production';
const data = resolve(root, process.env.DATA_DIR ?? 'data');
const ledgerPath = process.env.LEDGER_PATH
  ? resolve(root, process.env.LEDGER_PATH)
  : resolve(data, 'raidrumble.sqlite3');
const settingsPath = process.env.SETTINGS_PATH
  ? resolve(root, process.env.SETTINGS_PATH)
  : resolve(data, 'settings.json');
for (const path of [data, dirname(ledgerPath), dirname(settingsPath)])
  mkdirSync(path, { recursive: true });
const { app, live } = await createApp({
  ledgerPath,
  settingsPath,
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'), port });
try {
  await live.startCallbackRelay();
} catch {
  await app.close();
  throw new Error('Twitch callback listener could not start. Check the configured loopback port.');
}
const publicBase = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const dashboard = process.env.DASHBOARD_URL ?? (production ? publicBase : 'http://localhost:5174');
const overlay = process.env.OVERLAY_URL ?? (production ? publicBase : 'http://localhost:5173');
console.info(
  `RaidRumble ready · dashboard ${dashboard} · overlay ${new URL('/overlay/demo', overlay)}`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
