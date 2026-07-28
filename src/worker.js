// Cloudflare Worker entry point. Handles the small set of /api/strava/*
// routes server-side (where the OAuth client secret and tokens must stay),
// and falls through to the static build (dist/, via the ASSETS binding)
// for everything else — this is what actually serves the Vite app.
import { handleConnect, handleCallback, handleStatus, handleActivities } from './stravaServer.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/strava/connect') return handleConnect(request, env);
    if (url.pathname === '/api/strava/callback') return handleCallback(request, env);
    if (url.pathname === '/api/strava/status') return handleStatus(env);
    if (url.pathname === '/api/strava/activities') return handleActivities(request, env);

    return env.ASSETS.fetch(request);
  },
};
