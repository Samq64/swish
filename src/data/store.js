import { AppStore } from './store.svelte.js';
import { createApiRepository } from './apiRepository.js';

/**
 * The shared store instance for the app, wired to the Cloudflare API backend.
 */
export const store = new AppStore(createApiRepository());
