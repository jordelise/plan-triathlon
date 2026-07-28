// Cloudflare Worker entry point. Handles the small set of /api/strava/*
// routes server-side (where the OAuth client secret and tokens must stay),
// and falls through to the static build (dist/, via the ASSETS binding)
// for everything else — this is what actually serves the Vite app.
//
// Access control lives in Supabase Auth (email/password) now, enforced by
// RLS policies on every table, not at this layer — see supabase/require_auth.sql.
import { handleConnect, handleCallback, handleStatus, handleActivities, handleDisconnect } from './stravaServer.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/strava/connect') return handleConnect(request, env);
    if (url.pathname === '/api/strava/callback') return handleCallback(request, env);
    if (url.pathname === '/api/strava/status') return handleStatus(request, env);
    if (url.pathname === '/api/strava/disconnect') return handleDisconnect(request, env);
    if (url.pathname === '/api/strava/activities') return handleActivities(request, env);

    return env.ASSETS.fetch(request);
  },
};
