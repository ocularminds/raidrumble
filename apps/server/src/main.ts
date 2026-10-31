import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
mkdirSync(resolve(root, 'data'), { recursive: true });
const { app, live } = await createApp({
  ledgerPath: resolve(root, process.env.LEDGER_PATH ?? 'data/raidrumble.sqlite3'),
  settingsPath: resolve(root, 'data/settings.json'),
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
try {
  await live.startCallbackRelay();
} catch {
  await app.close();
  throw new Error('Twitch callback listener could not start. Check the configured loopback port.');
}
console.info(
  `RaidRumble ready · dashboard http://localhost:5174 · overlay http://localhost:5173/overlay/demo`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
