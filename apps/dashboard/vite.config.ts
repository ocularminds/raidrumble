import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { callbackPlugin } from './callback.js';

export default defineConfig(({ command, mode, isPreview }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, root, ['PUBLIC_BASE_URL', 'DASHBOARD_URL']);
  return {
    plugins:
      command === 'serve' && !isPreview
        ? [
            callbackPlugin(
              env.PUBLIC_BASE_URL || 'http://localhost:3000',
              env.DASHBOARD_URL || 'http://localhost:5174',
            ),
          ]
        : [],
  };
});
