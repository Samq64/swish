import { AppStore } from './store.svelte.js';
import { createLocalRepository } from './localRepository.js';

/**
 * The shared store instance for the app. Today it's wired to localStorage;
 * to move to a backend, swap this one line for `createApiRepository(...)`.
 */
export const store = new AppStore(createLocalRepository());
