import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Relative base so the build works under any GitHub Pages sub-path
  // (e.g. https://<user>.github.io/<repo>/) without hardcoding the repo name.
  base: './',
});
