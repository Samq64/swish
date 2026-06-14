// SvelteKit ambient types: the authenticated user (resolved once in
// hooks.server.js) and the Cloudflare bindings exposed on `platform.env`.
declare global {
  namespace App {
    interface Locals {
      user: { id: string; username: string; activeWorkspaceId: string | null } | null;
    }
    interface Platform {
      env: {
        DB: import('@cloudflare/workers-types').D1Database;
        PEPPER?: string;
      };
    }
  }
}

export {};
