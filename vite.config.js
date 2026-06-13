import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Served from the domain root on Cloudflare Pages.
  base: '/',
  server: {
    // In dev, proxy the API *and* the server-rendered auth routes to the local
    // Functions runtime (`npm run dev:api`) so the SPA keeps HMR while sign in /
    // up / out behave exactly like production. Without proxying the auth routes,
    // Vite's SPA fallback would serve the app at /login and a 401 redirect would
    // loop forever.
    proxy: {
      '/api': 'http://localhost:8788',
      '/login': 'http://localhost:8788',
      '/register': 'http://localhost:8788',
      '/logout': 'http://localhost:8788',
    },
  },
});
