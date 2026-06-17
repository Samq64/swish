import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Target Baseline 2024 — the floor already set by our use of CSS
    // light-dark() (Chrome/Edge 123, Firefox 120, Safari 17.5). esbuild only
    // lowers JS syntax newer than these; authored CSS is emitted as-is.
    target: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
  },
});
