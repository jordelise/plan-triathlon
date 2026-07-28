// Cloudflare Worker entry point. Handles the small set of /api/strava/*
// routes server-side (where the OAuth client secret and tokens must stay),
// and falls through to the static build (dist/, via the ASSETS binding)
// for everything else — this is what actually serves the Vite app.
import { handleConnect, handleCallback, handleStatus, handleActivities, handleDisconnect } from './stravaServer.js';

// Whole site (pages + API + the JS bundle carrying the Supabase key) sits
// behind one shared Basic Auth login — there's no per-user auth, so this is
// the only thing stopping a stranger with the URL from reading/writing the
// data directly against Supabase's REST API.
function isAuthorized(request, env) {
  if (!env.SITE_PASSWORD) return true; // not configured (e.g. local dev without .dev.vars) — don't lock yourself out
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  const [user, pass] = atob(auth.slice(6)).split(':');
  return user === (env.SITE_USERNAME || 'elise') && pass === env.SITE_PASSWORD;
}

export default {
  async fetch(request, env, ctx) {
    if (!isAuthorized(request, env)) {
      return new Response('Authentification requise', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Plan Triathlon"' },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/strava/connect') return handleConnect(request, env);
    if (url.pathname === '/api/strava/callback') return handleCallback(request, env);
    if (url.pathname === '/api/strava/status') return handleStatus(env);
    if (url.pathname === '/api/strava/disconnect') return handleDisconnect(env);
    if (url.pathname === '/api/strava/activities') return handleActivities(request, env);

    return env.ASSETS.fetch(request);
  },
};
