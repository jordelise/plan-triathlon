// Cloudflare Worker entry point. Handles the small set of /api/strava/*
// routes server-side (where the OAuth client secret and tokens must stay),
// and falls through to the static build (dist/, via the ASSETS binding)
// for everything else — this is what actually serves the Vite app.
import { handleConnect, handleCallback, handleStatus, handleActivities, handleDisconnect } from './stravaServer.js';

// Whole site (pages + API + the JS bundle carrying the Supabase key) sits
// behind one shared password — there's no per-user auth, so this is the
// only thing stopping a stranger with the URL from reading/writing the
// data directly against Supabase's REST API. Cookie-based rather than
// HTTP Basic Auth: iOS Safari doesn't support the Basic Auth dialog at
// all in standalone "Add to Home Screen" mode, which is how this app is
// actually used day to day.
const COOKIE_NAME = 'ptri_auth';

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function loginPageHtml(error) {
  const errorHtml = error ? `<p class="error">Mot de passe incorrect.</p>` : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion — Plan Triathlon</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F1ECDF;font-family:-apple-system,'IBM Plex Sans',sans-serif;}
  form{background:#fff;padding:28px 24px;border-radius:16px;box-shadow:0 8px 30px rgba(22,41,43,0.12);width:100%;max-width:320px;box-sizing:border-box;}
  h1{font-size:20px;margin:0 0 18px;color:#16292B;}
  input{width:100%;box-sizing:border-box;padding:12px 14px;font-size:16px;border:1px solid rgba(22,41,43,0.2);border-radius:10px;margin-top:4px;}
  button{width:100%;margin-top:16px;padding:12px;border:none;border-radius:10px;background:#E8502F;color:#fff;font-size:15px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
  .error{color:#E8502F;font-size:13px;margin:8px 0 0;}
</style>
</head>
<body>
<form method="POST" action="/login">
  <h1>Plan Triathlon</h1>
  <input type="password" name="password" placeholder="Mot de passe" autofocus required>
  ${errorHtml}
  <button type="submit">Se connecter</button>
</form>
</body>
</html>`;
}

async function isAuthorized(request, env) {
  if (!env.SITE_PASSWORD) return true; // not configured (e.g. local dev without .dev.vars) — don't lock yourself out
  const expected = await sha256Hex(`${env.SITE_PASSWORD}:${COOKIE_NAME}`);
  return getCookie(request, COOKIE_NAME) === expected;
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const password = form.get('password') || '';

  if (!env.SITE_PASSWORD || password !== env.SITE_PASSWORD) {
    return new Response(loginPageHtml(true), { status: 401, headers: { 'Content-Type': 'text/html' } });
  }

  const token = await sha256Hex(`${env.SITE_PASSWORD}:${COOKIE_NAME}`);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/login' && request.method === 'POST') return handleLogin(request, env);

    if (!(await isAuthorized(request, env))) {
      return new Response(loginPageHtml(false), { status: 401, headers: { 'Content-Type': 'text/html' } });
    }

    if (url.pathname === '/api/strava/connect') return handleConnect(request, env);
    if (url.pathname === '/api/strava/callback') return handleCallback(request, env);
    if (url.pathname === '/api/strava/status') return handleStatus(env);
    if (url.pathname === '/api/strava/disconnect') return handleDisconnect(env);
    if (url.pathname === '/api/strava/activities') return handleActivities(request, env);

    return env.ASSETS.fetch(request);
  },
};
