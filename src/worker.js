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
  const errorHtml = error ? `<p class="error">Mot de passe incorrect, réessaie.</p>` : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Triathlon de la Baie">
<meta name="theme-color" content="#16292B">
<title>Connexion — Plan Triathlon</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
  *{box-sizing:border-box;}
  body{
    margin:0;min-height:100vh;padding:20px;
    display:flex;align-items:center;justify-content:center;
    background:#F1ECDF;color:#16292B;
    font-family:'IBM Plex Sans',sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .card{width:100%;max-width:340px;text-align:center;}
  .icon{width:64px;height:64px;border-radius:18px;margin-bottom:18px;box-shadow:0 6px 20px rgba(22,41,43,0.18);}
  h1{
    font-family:'Oswald',sans-serif;font-weight:700;
    font-size:26px;text-transform:uppercase;line-height:1;
    margin:0 0 6px;letter-spacing:.01em;
  }
  h1 em{font-style:normal;color:#E8502F;}
  p.sub{margin:0 0 26px;font-size:13.5px;color:#4A4E46;opacity:.85;}
  form{background:#fff;padding:22px 20px;border-radius:16px;border:1px solid rgba(22,41,43,0.1);box-shadow:0 8px 30px rgba(22,41,43,0.1);}
  label{
    display:block;text-align:left;
    font-family:'IBM Plex Mono',monospace;font-size:11px;
    color:#4A4E46;text-transform:uppercase;letter-spacing:.06em;
    margin-bottom:6px;
  }
  input{
    width:100%;padding:13px 14px;font-size:16px;font-family:inherit;
    border:1px solid rgba(22,41,43,0.18);border-radius:10px;
    background:#F1ECDF;color:#16292B;
  }
  input:focus{outline:2px solid #E8502F;outline-offset:1px;}
  button{
    width:100%;margin-top:16px;padding:13px;border:none;border-radius:10px;
    background:#E8502F;color:#fff;
    font-family:'Oswald',sans-serif;font-size:14px;font-weight:600;
    text-transform:uppercase;letter-spacing:.06em;cursor:pointer;
  }
  button:active{opacity:.85;}
  .error{color:#E8502F;font-size:12.5px;margin:12px 0 0;text-align:left;}
</style>
</head>
<body>
<div class="card">
  <img class="icon" src="/icon.png" alt="">
  <h1><em>Plan</em> Triathlon</h1>
  <p class="sub">Accès privé — entre le mot de passe pour continuer.</p>
  <form method="POST" action="/login">
    <label for="password">Mot de passe</label>
    <input id="password" type="password" name="password" placeholder="••••••••" autofocus required autocomplete="current-password">
    ${errorHtml}
    <button type="submit">Se connecter</button>
  </form>
</div>
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

    // The home-screen icon has to be fetchable while logged out, otherwise
    // "Add to Home Screen" captures a blank/default icon instead.
    if (url.pathname === '/icon.png') return env.ASSETS.fetch(request);

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
