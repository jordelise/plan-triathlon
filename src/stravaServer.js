// Server-side Strava integration, run only inside the Cloudflare Worker
// (never bundled into the client build). Keeps the OAuth client secret and
// the resulting access/refresh tokens entirely off the client: the browser
// only ever talks to our own /api/strava/* routes and only ever receives
// trimmed activity JSON back, never a token.

const TOKENS_KEY = 'strava_tokens';

class StravaNotConnectedError extends Error {}

const DISCIPLINE_TYPES = {
  swim: ['Swim'],
  bike: ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide'],
  run: ['Run', 'TrailRun', 'VirtualRun'],
  strength: ['WeightTraining', 'Workout', 'Crossfit', 'Yoga'],
};

async function getValidAccessToken(env) {
  const stored = await env.STRAVA_KV.get(TOKENS_KEY, 'json');
  if (!stored) throw new StravaNotConnectedError();

  const now = Math.floor(Date.now() / 1000);
  if (stored.expires_at - now > 300) return stored.access_token;

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
    }),
  });

  if (!res.ok) {
    await env.STRAVA_KV.delete(TOKENS_KEY);
    throw new StravaNotConnectedError();
  }

  const fresh = await res.json();
  await env.STRAVA_KV.put(TOKENS_KEY, JSON.stringify({
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: fresh.expires_at,
  }));
  return fresh.access_token;
}

export function handleConnect(request, env) {
  const { origin } = new URL(request.url);
  const authorizeUrl = new URL('https://www.strava.com/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.STRAVA_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', `${origin}/api/strava/callback`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('approval_prompt', 'auto');
  authorizeUrl.searchParams.set('scope', 'activity:read_all');
  return Response.redirect(authorizeUrl.toString(), 302);
}

export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${url.origin}/?strava=error`, 302);
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    return Response.redirect(`${url.origin}/?strava=error`, 302);
  }

  const tokens = await res.json();
  await env.STRAVA_KV.put(TOKENS_KEY, JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    athlete_name: tokens.athlete ? `${tokens.athlete.firstname} ${tokens.athlete.lastname}`.trim() : null,
  }));

  return Response.redirect(`${url.origin}/?strava=connected`, 302);
}

export async function handleStatus(env) {
  const stored = await env.STRAVA_KV.get(TOKENS_KEY, 'json');
  if (!stored) return Response.json({ connected: false });
  return Response.json({
    connected: true,
    athlete_name: stored.athlete_name || null,
  });
}

export async function handleDisconnect(env) {
  await env.STRAVA_KV.delete(TOKENS_KEY);
  return Response.json({ connected: false });
}

export async function handleActivities(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const discipline = url.searchParams.get('discipline');

  if (!date || !discipline) {
    return Response.json({ error: 'missing_params' }, { status: 400 });
  }

  let accessToken;
  try {
    accessToken = await getValidAccessToken(env);
  } catch (err) {
    if (err instanceof StravaNotConnectedError) {
      return Response.json({ connected: false, matches: [] });
    }
    throw err;
  }

  const dayStart = Date.parse(`${date}T00:00:00Z`) / 1000;
  const after = dayStart - 86400;
  const before = dayStart + 2 * 86400;

  // Strava rejects `after` timestamps in the future outright — and a
  // session dated in the future obviously has no activity yet, so skip
  // the call entirely rather than surface that as an error.
  if (after * 1000 > Date.now()) {
    return Response.json({ connected: true, date, matches: [], future: true });
  }

  const stravaRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!stravaRes.ok) {
    console.error('Strava activities fetch failed', stravaRes.status, await stravaRes.text());
    return Response.json({ error: 'strava_api_error' }, { status: 502 });
  }

  const activities = await stravaRes.json();
  const sameDay = activities.filter(a => a.start_date_local?.slice(0, 10) === date);

  const trim = (a, matchedDiscipline) => ({
    id: a.id,
    name: a.name,
    sport_type: a.sport_type,
    matchedDiscipline,
    distance: a.distance,
    moving_time: a.moving_time,
    average_heartrate: a.average_heartrate ?? null,
    total_elevation_gain: a.total_elevation_gain,
    start_date_local: a.start_date_local,
  });

  let matches = [];
  if (discipline === 'mix') {
    const bike = sameDay.find(a => DISCIPLINE_TYPES.bike.includes(a.sport_type));
    const run = sameDay.find(a => DISCIPLINE_TYPES.run.includes(a.sport_type));
    if (bike) matches.push(trim(bike, 'bike'));
    if (run) matches.push(trim(run, 'run'));
  } else {
    const types = DISCIPLINE_TYPES[discipline] || [];
    matches = sameDay
      .filter(a => types.includes(a.sport_type))
      .map(a => trim(a, discipline));
  }

  // The list endpoint above only returns summary activities: no free-text
  // description (only on the single-activity detail endpoint) and no laps
  // (their own endpoint) — fetch both per matched activity, in parallel.
  const authHeaders = { headers: { Authorization: `Bearer ${accessToken}` } };
  matches = await Promise.all(matches.map(async (m) => {
    const [detail, laps] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${m.id}`, authHeaders)
        .then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`https://www.strava.com/api/v3/activities/${m.id}/laps`, authHeaders)
        .then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    return {
      ...m,
      description: detail?.description || null,
      laps: Array.isArray(laps)
        ? laps
            .filter(l => l.distance > 0)
            .map(l => ({
              lap_index: l.lap_index,
              distance: l.distance,
              moving_time: l.moving_time,
              average_heartrate: l.average_heartrate ?? null,
            }))
        : [],
    };
  }));

  return Response.json({ connected: true, date, matches });
}
