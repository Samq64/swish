// SvelteKit ambient types: the authenticated user (resolved once in
// hooks.server.js) and the Cloudflare bindings exposed on `platform.env`.
declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        username: string;
        activeWorkspaceId: string | null;
        theme: 'auto' | 'light' | 'dark';
        weekStart: 0 | 1;
        hour12: boolean;
      } | null;
    }
    interface Platform {
      env: {
        DB: import('@cloudflare/workers-types').D1Database;
        AI: import('@cloudflare/workers-types').Ai;
        PEPPER?: string;
      };
    }
  }
}

export {};
