<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';

  let { children } = $props();

  // Register the service worker for offline support (production only, so it
  // doesn't fight HMR in dev).
  onMount(() => {
    if (!dev && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  });
</script>

{@render children()}
