import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Cloudflare Pages. `platformProxy` exposes the wrangler.toml bindings
    // (D1 as `platform.env.DB`, secrets as `platform.env.*`) under `vite dev`,
    // so there's no separate Functions dev server.
    adapter: adapter({
      platformProxy: { persist: { path: '.wrangler/state/v3' } },
    }),
  },
};
