import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Served from the domain root on Cloudflare Pages.
  base: '/',
  server: {
    // In dev, proxy API calls to the local Functions runtime (`npm run dev:api`)
    // so the SPA keeps HMR while talking to the real backend.
    proxy: {
      '/api': 'http://localhost:8788',
    },
  },
});
