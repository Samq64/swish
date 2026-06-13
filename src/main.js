import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app') });

// Register the service worker for offline support. Production only, so it
// doesn't cache assets and fight HMR during development. Resolved relative to
// the document so it works under a GitHub Pages sub-path too.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

export default app;
