import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The SPA always calls a *relative* `/api`, so the browser only ever talks to
 * the origin that served the page. That is what keeps the Auth.js session
 * cookie first-party — `onrender.com` is on the Public Suffix List, so calling
 * the API cross-origin would make the cookie a third-party cookie and Safari
 * would silently drop it.
 *
 * This proxy supplies that same-origin behaviour in dev. Which backend it
 * targets is environment-driven, so `npm run dev:use-render-server` can point
 * the local UI at the deployed API without changing any app code:
 *
 *   VITE_API_PROXY_TARGET=http://localhost:3456   (default, local API)
 *   VITE_API_PROXY_TARGET=https://ink-finance-api.onrender.com
 */
export default defineConfig(({ mode }) => {
  // '' loads every variable, not just VITE_*-prefixed ones.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3456';

  return {
    plugins: [react()],
    server: {
      port: 5179,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
