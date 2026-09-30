import { supabase } from './supabaseClient.js';

// Calendar date range covered by each plan week: real Monday-Sunday weeks,
// starting from the Monday on/before the plan's first training day (Jul 21,
// a Tuesday, so week 1 is Jul 20-26). Week 12 ends on race day (Oct 11).
const WEEK_DATE_RANGES = {
  1: ['2026-07-20', '2026-07-26'],
  2: ['2026-07-27', '2026-08-02'],
  3: ['2026-08-03', '2026-08-09'],
  4: ['2026-08-10', '2026-08-16'],
  5: ['2026-08-17', '2026-08-23'],
  6: ['2026-08-24', '2026-08-30'],
  7: ['2026-08-31', '2026-09-06'],
  8: ['2026-09-07', '2026-09-13'],
  9: ['2026-09-14', '2026-09-20'],
  10: ['2026-09-21', '2026-09-27'],
  11: ['2026-09-28', '2026-10-04'],
  12: ['2026-10-05', '2026-10-11'],
};

function weekCreditFraction(weekNumber, now){
  const range = WEEK_DATE_RANGES[weekNumber];
  if (!range) return 0;
  const start = new Date(range[0] + 'T00:00:00');
  const end = new Date(range[1] + 'T00:00:00');
  if (now < start) return 0;
  if (now > end) return 1;
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const elapsedDays = Math.floor((now - start) / 86400000) + 1;
  return Math.min(1, elapsedDays / totalDays);
}

const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatWeekDates(range){
  const start = new Date(range[0] + 'T00:00:00');
  const end = new Date(range[1] + 'T00:00:00');
  const startMonth = FR_MONTHS[start.getMonth()];
  const endMonth = FR_MONTHS[end.getMonth()];

  return startMonth === endMonth
    ? `${start.getDate()} → ${end.getDate()} ${endMonth}`
    : `${start.getDate()} ${startMonth} → ${end.getDate()} ${endMonth}`;
}

function currentWeekNumber(now){
  const weekNumbers = Object.keys(WEEK_DATE_RANGES).map(Number).sort((a, b) => a - b);
  for (const w of weekNumbers) {
    const end = new Date(WEEK_DATE_RANGES[w][1] + 'T00:00:00');
    if (now <= end) return w;
  }
  return weekNumbers[weekNumbers.length - 1];
}

const FR_WEEKDAYS = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];

function escapeHtml(str){
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let sessionsByKey = new Map();
let raceTargetDate = null;

const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 12 9 17 20 6"/></svg>';

function dayRowHtml(s){
  const d = new Date(s.session_date + 'T00:00:00');
  return `<div class="day-row"><div class="day-badge"><div class="day-name">${FR_WEEKDAYS[d.getDay()]}</div><div class="day-num">${d.getDate()}</div></div><button type="button" class="day-card ${s.discipline}${s.done ? ' done' : ''}" data-key="${s.session_key}"><span class="day-card-icon">${s.icon}</span><span class="day-card-title">${escapeHtml(s.title)}</span><span class="day-card-check">${s.done ? CHECK_ICON_SVG : ''}</span></button></div>`;
}

function formatDurationBadge(minutes){
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `≈${h}h${String(m).padStart(2, '0')}`;
  }
  return `≈${Math.round(minutes)} min`;
}

function sessionDetailHtml(s){
  const tagHtml = s.tag ? `<span class="tag">${escapeHtml(s.tag)}</span>` : '';
  const durationHtml = s.duration_min ? `<span class="tag">${formatDurationBadge(s.duration_min)}</span>` : '';
  const segments = s.segments || [];
  const zoneChip = zone => `<span class="zone-chip ${zone.toLowerCase()}">${zone}</span>`;
  const keyPaceChip = '<span class="zone-chip zc">allure cible</span>';
  // Zones written in a segment's text ("100 Z1", "allure cible") are shown
  // as chips too - a swim set mixes several zones within one segment. Plans
  // generated before the rename still say "allure clé".
  const KEY_PACE_TEXT = /allure (?:cible|clé)/g;
  const withZoneChips = text => text
    .replace(/\bZ[1-5]\b/g, zone => zoneChip(zone))
    .replace(KEY_PACE_TEXT, keyPaceChip);
  const segsHtml = segments
    .map(seg => `<span class="seg"><b class="seg-label">${escapeHtml(seg.label)}</b>${ZONES[seg.zone] ? ' ' + zoneChip(seg.zone) : ''} ${withZoneChips(seg.text)}</span>`)
    .join('');
  // What each zone used in this session feels like, so the athlete knows
  // how hard to go without heart-rate or pace targets.
  const zonesUsed = Object.keys(ZONES).filter(z => segments.some(seg => seg.zone === z || new RegExp(`\\b${z}\\b`).test(seg.text)));
  const legendRows = zonesUsed.map(z => `<div class="zone-legend-row">${zoneChip(z)}<span><b>${ZONES[z].name}</b> · ${ZONES[z].feel}</span></div>`);
  if (segments.some(seg => /allure (?:cible|clé)/.test(seg.text))) {
    legendRows.push(`<div class="zone-legend-row">${keyPaceChip}<span>${KEY_PACE.feel}</span></div>`);
  }
  const zoneLegendHtml = legendRows.length ? `<div class="zone-legend">${legendRows.join('')}</div>` : '';
  const stravaHtml = s.session_date
    ? `<p class="detail-card-title">Résultat de la séance</p><div class="detail-card detail-strava"><div id="detail-strava"><p class="detail-strava-status">Chargement Strava…</p></div></div>`
    : '';
  // Test: only s2-3 has a hand-built .fit file for now, to validate the
  // Garmin import flow before generating one per session.
  const fitHtml = s.session_key === 's2-3'
    ? `<a class="detail-fit-link" href="/fit/s2-3-sortie-longue.fit" download aria-label="Télécharger la séance (test Garmin)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><polyline points="12 9 12 12 13.5 13.5"/><path d="M16.51 17.35l-.35 3.83a2 2 0 0 1-2 1.82H9.83a2 2 0 0 1-2-1.82l-.35-3.83m.01-10.7.35-3.83A2 2 0 0 1 9.83 1h4.35a2 2 0 0 1 2 1.82l.35 3.83"/></svg></a>`
    : '';

  return `<div class="detail-head"><span class="detail-icon">${s.icon}</span><div class="detail-title-row"><span class="detail-title">${escapeHtml(s.title)}</span>${tagHtml}${durationHtml}</div></div><div class="detail-meta-row"><label class="detail-date-field">Date<input type="date" id="detail-date-input" data-key="${s.session_key}" value="${s.session_date || ''}"></label><label class="detail-done-toggle">Fait<span class="detail-done-box-wrap"><input type="checkbox" id="detail-done-checkbox" data-key="${s.session_key}"${s.done ? ' checked' : ''}><span class="detail-done-box"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 12 9 17 20 6"/></svg></span></span></label>${fitHtml}</div><p class="detail-card-title">Détail de la séance</p><div class="detail-card"><p class="detail-segments">${segsHtml}</p>${zoneLegendHtml}</div>${stravaHtml}`;
}

let stravaRequestSeq = 0;

function formatDistTimePace(discipline, distanceM, movingTimeSec){
  if (discipline === 'swim') {
    return `${Math.round(distanceM)} m · ${formatMMSS(movingTimeSec)} · ${formatPacePer100(movingTimeSec, distanceM)}/100m`;
  }
  if (discipline === 'run') {
    return `${(distanceM / 1000).toFixed(1)} km · ${formatMMSS(movingTimeSec)} · ${formatPacePerKm(movingTimeSec, distanceM / 1000)}/km`;
  }
  if (discipline === 'bike') {
    return `${(distanceM / 1000).toFixed(1)} km · ${formatHMM(movingTimeSec)} · ${formatSpeedKmh(movingTimeSec, distanceM / 1000)} km/h`;
  }
  return formatMMSS(movingTimeSec);
}

function formatStravaStats(a){
  return formatDistTimePace(a.matchedDiscipline, a.distance, a.moving_time);
}

function stravaLapsHtml(a){
  if (!a.laps || a.laps.length < 2) return '';
  const rows = a.laps.map(l => {
    const hr = l.average_heartrate ? ` · ${Math.round(l.average_heartrate)} bpm` : '';
    return `<div class="strava-lap-row"><span class="strava-lap-num">${l.lap_index}</span><span>${formatDistTimePace(a.matchedDiscipline, l.distance, l.moving_time)}${hr}</span></div>`;
  }).join('');
  return `<div class="strava-laps">${rows}</div>`;
}

function stravaActivityCardHtml(a){
  const hr = a.average_heartrate ? ` · ${Math.round(a.average_heartrate)} bpm moy.` : '';
  const descHtml = a.description
    ? `<p class="strava-activity-desc">${escapeHtml(a.description)}</p>`
    : '';
  return `<div class="strava-activity"><div class="strava-activity-name">${escapeHtml(a.name)}</div><div class="strava-stats-row">${formatStravaStats(a)}${hr}</div>${descHtml}${stravaLapsHtml(a)}</div>`;
}

async function stravaAuthHeaders(){
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function goToStravaConnect(){
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  window.location.href = `/api/strava/connect?access_token=${encodeURIComponent(data.session.access_token)}`;
}

function renderStravaState(data, ok){
  const el = document.getElementById('detail-strava');
  if (!el) return;

  if (!ok) {
    el.innerHTML = `<p class="detail-strava-status">Impossible de charger les stats Strava.</p>`;
    return;
  }
  if (!data.connected) {
    el.innerHTML = `<p class="detail-strava-status"><a href="#" id="strava-connect-link-detail">Connecter Strava</a> pour voir les activités réelles.</p>`;
    document.getElementById('strava-connect-link-detail').addEventListener('click', (e) => {
      e.preventDefault();
      goToStravaConnect();
    });
    return;
  }
  if (data.future) {
    el.innerHTML = `<p class="detail-strava-status">Séance à venir - pas encore réalisée.</p>`;
    return;
  }
  if (!data.matches.length) {
    el.innerHTML = `<p class="detail-strava-status">Séance pas encore réalisée (ou pas trouvée sur Strava).</p>`;
    return;
  }
  el.innerHTML = data.matches.map(stravaActivityCardHtml).join('');
}

function setSessionDone(key, done){
  const sess = sessionsByKey.get(key);
  if (!sess || sess.done === done) return;
  sess.done = done;
  saveCompletion(key, done);
  updateDayCardDone(key, done);
  const checkbox = document.getElementById('detail-done-checkbox');
  if (checkbox && checkbox.dataset.key === key) checkbox.checked = done;
  refreshWeekCounts();
  refreshProgress();
}

async function loadStravaForSession(s){
  const seq = ++stravaRequestSeq;
  try {
    const res = await fetch(`/api/strava/activities?date=${s.session_date}&discipline=${s.discipline}`, {
      headers: await stravaAuthHeaders(),
    });
    if (seq !== stravaRequestSeq) return;
    const data = await res.json();
    renderStravaState(data, res.ok);
    if (res.ok && data.connected && data.matches?.length && !s.done) {
      setSessionDone(s.session_key, true);
    }
  } catch (err) {
    if (seq !== stravaRequestSeq) return;
    console.error('Erreur Strava', err);
    renderStravaState(null, false);
  }
}

async function renderStravaSettingsContent(containerId = 'detail-content', showHeading = true){
  const el = document.getElementById(containerId);
  const heading = showHeading ? '<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div>' : '';
  try {
    const res = await fetch('/api/strava/status', { headers: await stravaAuthHeaders() });
    const data = await res.json();
    if (data.connected) {
      const who = data.athlete_name ? `Connecté à <b>Strava</b> en tant que <b>${escapeHtml(data.athlete_name)}</b>.` : 'Connecté à <b>Strava</b>.';
      el.innerHTML = `${heading}<p class="settings-status">${who}</p><button type="button" class="settings-btn disconnect" id="strava-disconnect-btn">Déconnecter</button>`;
      document.getElementById('strava-disconnect-btn').addEventListener('click', async () => {
        await fetch('/api/strava/disconnect', { headers: await stravaAuthHeaders() });
        renderStravaSettingsContent(containerId, showHeading);
      });
    } else {
      el.innerHTML = `${heading}<p class="settings-status">Non connecté à <b>Strava</b>.</p><p class="settings-sub">Connecte ton compte Strava pour voir les vraies stats de tes séances.</p><a href="#" class="settings-btn connect" id="strava-connect-link">Connecter Strava</a>`;
      document.getElementById('strava-connect-link').addEventListener('click', (e) => {
        e.preventDefault();
        goToStravaConnect();
      });
    }
  } catch {
    el.innerHTML = `${heading}<p class="settings-status">Impossible de vérifier la connexion Strava.</p>`;
  }
}

function openStravaSettings(){
  document.getElementById('detail-content').innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div><p class="settings-status">Chargement de Strava…</p>`;
  openDetailOverlay();
  renderStravaSettingsContent();
}

document.getElementById('strava-settings-row').addEventListener('click', openStravaSettings);

async function isStravaVisible(){
  try {
    const res = await fetch('/api/strava/status', { headers: await stravaAuthHeaders() });
    const data = await res.json();
    return !!data.visible;
  } catch {
    return false;
  }
}

async function refreshStravaRowVisibility(){
  document.getElementById('strava-settings-row').hidden = !(await isStravaVisible());
}

function weekBlockHtml(weekNumber, sessions, isOpen){
  const label = `Semaine S${weekNumber}`;
  const sorted = [...sessions].sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));
  // Derive the displayed range from the sessions themselves rather than the
  // hardcoded WEEK_DATE_RANGES map, which only covers the real hand-written
  // plan's calendar - a generated plan's own week N would otherwise show
  // that plan's unrelated dates.
  const sessionDates = sorted.map(s => s.session_date).filter(Boolean);
  const range = sessionDates.length ? [sessionDates[0], sessionDates[sessionDates.length - 1]] : null;
  const datesHtml = range ? `<span class="week-dates">${formatWeekDates(range)}</span>` : '';
  const doneCount = sessions.filter(s => s.done).length;

  return `<details class="week-block" data-week="wk${weekNumber}"${isOpen ? ' open' : ''}><summary class="week-heading"><span>${label} ${datesHtml}</span><span class="week-right"><span class="week-count"><span class="wc-done">${doneCount}</span>/${sessions.length}</span><svg class="chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="day-list">${sorted.map(dayRowHtml).join('')}</div></details>`;
}

async function loadAndRenderSessions(){
  const { data, error } = await supabase
    .from('plan_sessions')
    .select('*')
    .order('week_number', { ascending: true })
    .order('order_index', { ascending: true });

  // On error, still fall through with an empty session set instead of
  // bailing out - otherwise whichever account's sessions were on screen
  // before (a previous account switched from, in the same page session)
  // stay there indefinitely instead of clearing.
  if (error) console.error('Erreur de chargement', error);
  const rows = error ? [] : data;

  sessionsByKey = new Map(rows.map(s => [s.session_key, { ...s }]));

  const byPhase = new Map();
  for (const row of rows) {
    if (!byPhase.has(row.phase)) byPhase.set(row.phase, new Map());
    const weeks = byPhase.get(row.phase);
    if (!weeks.has(row.week_number)) weeks.set(row.week_number, []);
    weeks.get(row.week_number).push(row);
  }

  const activeWeek = currentWeekNumber(new Date());

  document.querySelectorAll('.week-list').forEach(container => {
    const phase = Number(container.dataset.phase);
    const weeks = byPhase.get(phase);
    if (!weeks) {
      container.innerHTML = '';
      return;
    }
    const weekNumbers = Array.from(weeks.keys()).sort((a, b) => a - b);
    container.innerHTML = weekNumbers
      .map(wn => weekBlockHtml(wn, weeks.get(wn), wn === activeWeek))
      .join('');
  });

  attachDayCardHandlers();
  refreshProgress();
}

function attachDayCardHandlers(){
  document.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.key));
  });
}

function openDetail(sessionKey){
  const s = sessionsByKey.get(sessionKey);
  if (!s) return;

  const content = document.getElementById('detail-content');
  content.innerHTML = sessionDetailHtml(s);
  if (s.session_date) loadStravaForSession(s);

  const checkbox = document.getElementById('detail-done-checkbox');
  checkbox.addEventListener('change', () => {
    setSessionDone(checkbox.dataset.key, checkbox.checked);
  });

  const dateInput = document.getElementById('detail-date-input');
  dateInput.addEventListener('change', () => {
    const key = dateInput.dataset.key;
    if (dateInput.value) saveSessionDate(key, dateInput.value);
  });

  openDetailOverlay();
}

async function saveSessionDate(sessionKey, dateStr){
  const { error } = await supabase
    .from('plan_sessions')
    .update({ session_date: dateStr, updated_at: new Date().toISOString() })
    .eq('session_key', sessionKey);

  if (error) {
    console.error('Erreur de sauvegarde de la date', error);
    return;
  }

  const sess = sessionsByKey.get(sessionKey);
  if (!sess) return;
  sess.session_date = dateStr;
  reRenderWeekDayList(sess.phase, sess.week_number);
}

function reRenderWeekDayList(phase, weekNumber){
  const container = document.querySelector(`.week-list[data-phase="${phase}"] .week-block[data-week="wk${weekNumber}"] .day-list`);
  if (!container) return;

  const sessions = Array.from(sessionsByKey.values())
    .filter(s => s.phase === phase && s.week_number === weekNumber)
    .sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));

  container.innerHTML = sessions.map(dayRowHtml).join('');
  container.querySelectorAll('.day-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.key));
  });
}

function openDetailOverlay(){
  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail(){
  document.getElementById('detail-overlay').classList.remove('open');
}

function openGoalSheet(){
  document.getElementById('goal-sheet-overlay').classList.add('open');
}

function closeGoalSheet(){
  document.getElementById('goal-sheet-overlay').classList.remove('open');
}

document.getElementById('goal-sheet-close').addEventListener('click', closeGoalSheet);
document.getElementById('goal-sheet-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'goal-sheet-overlay') closeGoalSheet();
});

function updateDayCardDone(key, done){
  const card = document.querySelector(`.day-card[data-key="${key}"]`);
  if (!card) return;
  card.classList.toggle('done', done);
  const check = card.querySelector('.day-card-check');
  if (check) check.innerHTML = done ? CHECK_ICON_SVG : '';
}

function refreshWeekCounts(){
  document.querySelectorAll('.week-block').forEach(block => {
    const cards = Array.from(block.querySelectorAll('.day-card'));
    const done = cards.filter(c => c.classList.contains('done')).length;
    const el = block.querySelector('.wc-done');
    if (el) el.textContent = done;
  });
}

const PROGRESS_RENFO_KEY = 'progress-include-renfo';

function progressIncludesRenfo(){
  try { return localStorage.getItem(PROGRESS_RENFO_KEY) !== '0'; } catch { return true; }
}

const progressRenfoToggle = document.getElementById('progress-renfo-toggle');
if (progressRenfoToggle) {
  progressRenfoToggle.checked = progressIncludesRenfo();
  progressRenfoToggle.addEventListener('change', () => {
    try { localStorage.setItem(PROGRESS_RENFO_KEY, progressRenfoToggle.checked ? '1' : '0'); } catch {}
    refreshProgress();
  });
}

function refreshProgress(){
  const now = new Date();
  const includeRenfo = progressIncludesRenfo();
  const counted = Array.from(sessionsByKey.values()).filter(s => includeRenfo || s.discipline !== 'strength');

  const weeks = new Map();
  for (const s of counted) {
    if (!weeks.has(s.week_number)) weeks.set(s.week_number, []);
    weeks.get(s.week_number).push(s);
  }

  const totalSessions = counted.length;

  const expectedSessions = Array.from(weeks.entries()).reduce(
    (sum, [weekNumber, sessions]) => sum + sessions.length * weekCreditFraction(weekNumber, now),
    0
  );
  const expectedPct = totalSessions ? (expectedSessions / totalSessions * 100) : 0;

  const done = counted.filter(s => s.done).length;
  const actualPct = totalSessions ? (done / totalSessions * 100) : 0;

  const expectedFill = document.getElementById('progress-expected-fill');
  const actualFill = document.getElementById('progress-actual-fill');
  const expectedVal = document.getElementById('progress-expected-val');
  const actualVal = document.getElementById('progress-actual-val');

  if (expectedFill) expectedFill.style.width = expectedPct + '%';
  if (actualFill) actualFill.style.width = actualPct + '%';
  if (expectedVal) expectedVal.textContent = Math.round(expectedPct) + '%';
  if (actualVal) actualVal.textContent = Math.round(actualPct) + '%';
}

async function saveCompletion(sessionKey, done){
  const { error } = await supabase
    .from('plan_sessions')
    .update({ done, updated_at: new Date().toISOString() })
    .eq('session_key', sessionKey);

  if (error) console.error('Erreur de sauvegarde', error);
}

document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'detail-overlay') closeDetail();
});

function openTimelineOverlay(){
  const svg = document.getElementById('timeline-svg');
  if (!svg) return;
  document.getElementById('timeline-overlay-content').innerHTML = svg.outerHTML;
  document.getElementById('timeline-overlay').classList.add('open');
}

function closeTimelineOverlay(){
  document.getElementById('timeline-overlay').classList.remove('open');
}

document.getElementById('timeline-card').addEventListener('click', openTimelineOverlay);
document.getElementById('timeline-overlay-close').addEventListener('click', closeTimelineOverlay);
document.getElementById('timeline-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'timeline-overlay') closeTimelineOverlay();
});

async function initApp(){
  // Awaited so the caller can keep the auth gate up until this account's
  // real data is loaded and rendered - otherwise whatever was already in
  // the DOM (a previous account's data, or the static placeholder markup
  // on first load) stays visible for a moment before being replaced.
  await Promise.all([
    loadAndRenderSessions(),
    loadAndRenderExercises(),
    loadAndRenderGoals(),
    loadAndRenderPreferences(),
    refreshStravaRowVisibility(),
  ]);

  if (new URLSearchParams(location.search).has('strava')) {
    history.replaceState(null, '', location.pathname);
    openStravaSettings();
  }
}

const authGate = document.getElementById('auth-gate');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authInfo = document.getElementById('auth-info');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleLink = document.getElementById('auth-toggle-link');
const authRecoveryForm = document.getElementById('auth-recovery-form');
const authRecoveryError = document.getElementById('auth-recovery-error');

let authMode = 'signin';

authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  authError.hidden = true;
  authInfo.hidden = true;
  const passwordInput = document.getElementById('auth-password');
  if (authMode === 'signup') {
    authSubmitBtn.textContent = 'Créer le compte';
    authToggleLink.textContent = 'Déjà un compte ? Se connecter';
    passwordInput.autocomplete = 'new-password';
  } else {
    authSubmitBtn.textContent = 'Se connecter';
    authToggleLink.textContent = 'Pas encore de compte ? Créer un compte';
    passwordInput.autocomplete = 'current-password';
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  authSubmitBtn.disabled = true;
  authError.hidden = true;
  authInfo.hidden = true;

  if (authMode === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    authSubmitBtn.disabled = false;
    if (error) {
      authError.textContent = error.message;
      authError.hidden = false;
      return;
    }
    if (!data.session) {
      authInfo.textContent = 'Compte créé. Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.';
      authInfo.hidden = false;
      authToggleLink.click();
    }
    // If email confirmation is disabled, a session comes back immediately
    // and onAuthStateChange below hides the gate and starts the app.
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  authSubmitBtn.disabled = false;
  if (error) {
    authError.textContent = 'Email ou mot de passe incorrect.';
    authError.hidden = false;
  }
  // On success, onAuthStateChange below hides the gate and starts the app.
});

authRecoveryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('auth-new-password').value;
  const submitBtn = authRecoveryForm.querySelector('button');

  submitBtn.disabled = true;
  authRecoveryError.hidden = true;

  const { error } = await supabase.auth.updateUser({ password });

  submitBtn.disabled = false;
  if (error) {
    console.error('Erreur updateUser (recovery)', error);
    authRecoveryError.textContent = `Impossible d'enregistrer ce mot de passe : ${error.message}`;
    authRecoveryError.hidden = false;
    return;
  }
  authRecoveryForm.hidden = true;
  authForm.hidden = false;
  authGate.hidden = true;
  if (!appStarted) {
    appStarted = true;
    initApp();
  }
});

let initializedUserId = null;
let inRecovery = false;

document.getElementById('sign-out-btn').addEventListener('click', () => {
  document.getElementById('m1').checked = true;
  supabase.auth.signOut();
});

const FULL_ACCESS_EMAIL = 'elisejord@gmail.com';

function updatePlanTabVisibility(email){
  const hasFullAccess = email === FULL_ACCESS_EMAIL;
  document.getElementById('plan-nav-item').hidden = !hasFullAccess;
  if (!hasFullAccess && document.getElementById('m2').checked) {
    document.getElementById('m1').checked = true;
  }
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    inRecovery = true;
    authGate.hidden = false;
    authForm.hidden = true;
    authRecoveryForm.hidden = false;
    return;
  }

  if (inRecovery) return; // stay on the recovery form until it is submitted

  if (session) {
    // Re-run on first login and whenever a different account signs in
    // within the same page session (sign out then back in as someone
    // else) - not on every token refresh for the same user. The gate
    // stays up until the fetch resolves, so the previous account's (or
    // the static placeholder's) data is never revealed even briefly.
    if (session.user.id !== initializedUserId) {
      initializedUserId = session.user.id;
      await initApp();
    }
    updatePlanTabVisibility(session.user.email);
    authGate.hidden = true;
  } else {
    authGate.hidden = false;
    initializedUserId = null;
  }
});

function formatMMSS(totalSec){
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Mobile numeric keypads (inputmode="numeric") have no ':' or "'" key, so
// digit-only input (e.g. "530") must still parse - treat the last two
// digits as the minor unit (seconds/minutes) and the rest as the major
// unit (minutes/hours), the same convention stopwatch/timer keypads use.
function splitDigitPair(str){
  const digits = str.replace(/\D/g, '');
  if (!digits) return { major: 0, minor: 0 };
  return { major: Number(digits.slice(0, -2)) || 0, minor: Number(digits.slice(-2)) };
}

// Live-inserts the separator as digits are typed (e.g. "530" -> "5:30"),
// so the field itself shows what's being entered even on a numeric keypad
// that has no ':' or "'" key to type.
function maskDigitInput(input, separator){
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) return;
    const minor = digits.slice(-2).padStart(2, '0');
    const major = digits.slice(0, -2) || '0';
    input.value = `${Number(major)}${separator}${minor}`;
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function parseMMSS(str){
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  }
  const { major, minor } = splitDigitPair(str);
  return major * 60 + minor;
}

function formatHMM(totalSec){
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseHMM(str){
  if (str.includes(':')) {
    const [h, m] = str.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  }
  const { major, minor } = splitDigitPair(str);
  return major * 3600 + minor * 60;
}

function formatPacePer100(durationSec, distanceM){
  const per100Sec = durationSec / (distanceM / 100);
  const m = Math.floor(per100Sec / 60);
  const s = Math.round(per100Sec % 60);
  return `${m}'${String(s).padStart(2, '0')}`;
}

function parsePacePer100(str, distanceM){
  const match = str.match(/(\d+)['’](\d+)/);
  let per100Sec;
  if (match) {
    per100Sec = Number(match[1]) * 60 + Number(match[2]);
  } else {
    const { major, minor } = splitDigitPair(str);
    if (!major && !minor) return null;
    per100Sec = major * 60 + minor;
  }
  return per100Sec * (distanceM / 100);
}

function formatPacePerKm(durationSec, distanceKm){
  const perKmSec = durationSec / distanceKm;
  const m = Math.floor(perKmSec / 60);
  const s = Math.round(perKmSec % 60);
  return `${m}'${String(s).padStart(2, '0')}`;
}

function parsePacePerKm(str, distanceKm){
  const match = str.match(/(\d+)['’](\d+)/);
  let perKmSec;
  if (match) {
    perKmSec = Number(match[1]) * 60 + Number(match[2]);
  } else {
    const { major, minor } = splitDigitPair(str);
    if (!major && !minor) return null;
    perKmSec = major * 60 + minor;
  }
  return perKmSec * distanceKm;
}

function formatSpeedKmh(durationSec, distanceKm){
  const speed = distanceKm / (durationSec / 3600);
  return Math.round(speed);
}

function parseSpeedKmh(str, distanceKm){
  const speed = parseFloat(str);
  if (!speed) return null;
  return (distanceKm / speed) * 3600;
}

let currentGoals = null;
let currentPreferences = null;
let currentConstraints = [];

function renderGoals(goals){
  const durationOrDash = (sec, formatter) => (sec == null ? '-' : '~' + formatter(sec));
  const paceOrDash = (sec, dist, formatter, unit) => (sec == null || dist == null ? '-' : formatter(sec, dist) + unit);

  document.getElementById('split-swim-duration').textContent = durationOrDash(goals.swim_duration_sec, formatMMSS);
  document.getElementById('split-swim-pace').textContent = paceOrDash(goals.swim_duration_sec, goals.swim_distance_m, formatPacePer100, '/100m');
  document.getElementById('split-t1-duration').textContent = durationOrDash(goals.t1_duration_sec, formatMMSS);
  document.getElementById('split-bike-duration').textContent = durationOrDash(goals.bike_duration_sec, formatHMM);
  document.getElementById('split-bike-speed').textContent = paceOrDash(goals.bike_duration_sec, goals.bike_distance_km, formatSpeedKmh, ' km/h');
  document.getElementById('split-t2-duration').textContent = durationOrDash(goals.t2_duration_sec, formatMMSS);
  document.getElementById('split-run-duration').textContent = durationOrDash(goals.run_duration_sec, formatMMSS);
  document.getElementById('split-run-pace').textContent = paceOrDash(goals.run_duration_sec, goals.run_distance_km, formatPacePerKm, '/km');

  const durations = [goals.swim_duration_sec, goals.t1_duration_sec, goals.bike_duration_sec, goals.t2_duration_sec, goals.run_duration_sec];
  if (durations.some(v => v == null)) {
    document.getElementById('split-total').textContent = '-';
    return;
  }
  const totalMin = Math.round(durations.reduce((a, b) => a + b, 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  document.getElementById('split-total').textContent = `≈ ${h}h${String(m).padStart(2, '0')}`;
}

function updateSplitLabels(goals){
  document.getElementById('split-swim-label').textContent = goals.swim_distance_m == null ? '-' : `${goals.swim_distance_m} m`;
  document.getElementById('split-bike-label').textContent = goals.bike_distance_km == null ? '-' : `${goals.bike_distance_km} km`;
  document.getElementById('split-run-label').textContent = goals.run_distance_km == null ? '-' : `${goals.run_distance_km} km`;
}

function setHomeRaceConfigurable(configurable){
  document.querySelector('.home-header').classList.toggle('configurable', configurable);
  document.getElementById('countdown-block').classList.toggle('configurable', configurable);
}

function renderRaceInfo(goals){
  if (!goals.race_date) {
    document.getElementById('home-race-name').innerHTML = `<em>Mon</em> triathlon`;
    document.getElementById('home-race-day').textContent = '-';
    document.getElementById('home-race-month').textContent = '';
    document.title = 'Plan Triathlon';
    raceTargetDate = null;
    ['cd-days', 'cd-hours', 'cd-mins', 'cd-secs'].forEach(id => {
      document.getElementById(id).textContent = '--';
    });
    setHomeRaceConfigurable(true);
    return;
  }

  if (goals.name) {
    const [firstWord, ...rest] = goals.name.split(' ');
    document.getElementById('home-race-name').innerHTML = `<em>${escapeHtml(firstWord)}</em>${rest.length ? ' ' + escapeHtml(rest.join(' ')) : ''}`;
  } else {
    document.getElementById('home-race-name').innerHTML = `<em>Mon</em> triathlon`;
  }
  const d = new Date(goals.race_date + 'T00:00:00');
  document.getElementById('home-race-day').textContent = d.getDate();
  document.getElementById('home-race-month').textContent = FR_MONTHS[d.getMonth()];
  document.title = `Plan Triathlon ${goals.size} - ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
  raceTargetDate = new Date(goals.race_date + 'T10:00:00');
  // Refresh the displayed digits immediately - otherwise they keep
  // showing whichever account's countdown was on screen before (or the
  // initial "--") until the next 1s setInterval tick fires.
  updateCountdown();
  setHomeRaceConfigurable(false);
}

function openRaceInfoEditorIfUnconfigured(){
  if (currentGoals && !currentGoals.race_date) openRaceInfoEditor();
}

document.querySelector('.home-header').addEventListener('click', openRaceInfoEditorIfUnconfigured);
document.getElementById('countdown-block').addEventListener('click', openRaceInfoEditorIfUnconfigured);

async function loadAndRenderGoals(){
  const { data, error } = await supabase.from('plan_race_goals').select('*').single();
  if (error) {
    // No row for this account (e.g. it was never created, or got deleted) -
    // PostgREST's .single() 406s on zero rows. Fall back to a blank goals
    // object instead of just logging and bailing: otherwise every render
    // function below never runs, leaving whichever account's data was on
    // screen before (name, countdown, splits) stuck there indefinitely.
    console.error('Erreur de chargement des objectifs (compte sans ligne plan_race_goals ?)', error);
    const { data: { session } } = await supabase.auth.getSession();
    currentGoals = {
      user_id: session?.user?.id,
      name: null, race_date: null, size: 'M',
      swim_distance_m: null, swim_duration_sec: null, t1_duration_sec: null,
      bike_distance_km: null, bike_duration_sec: null, t2_duration_sec: null,
      run_distance_km: null, run_duration_sec: null,
    };
  } else {
    currentGoals = data;
  }
  renderGoals(currentGoals);
  updateSplitLabels(currentGoals);
  renderRaceInfo(currentGoals);
  maybeShowOnboardingPopup(currentGoals);
  renderTrainingPrefsPanel();
}

async function loadAndRenderPreferences(){
  // Reset wizard state so switching accounts within the same page session
  // (no full reload) re-evaluates onboarding status for whichever account
  // just signed in, instead of carrying over the previous account's state.
  trainingPrefsOnboardingDone = null;
  trainingPrefsStep = 1;

  const [{ data: prefsData, error: prefsError }, { data: constraintsData, error: constraintsError }] = await Promise.all([
    supabase.from('plan_preferences').select('*').single(),
    supabase.from('plan_constraints').select('*').order('start_date'),
  ]);

  if (prefsError) {
    console.error('Erreur de chargement des préférences', prefsError);
    const { data: { session } } = await supabase.auth.getSession();
    currentPreferences = { user_id: session?.user?.id, training_days: [], preferred_disciplines: [], discipline_priority: {}, plan_start_date: null, strength_sessions_per_week: 0 };
  } else {
    currentPreferences = prefsData;
  }

  if (constraintsError) {
    console.error('Erreur de chargement des contraintes', constraintsError);
    currentConstraints = [];
  } else {
    currentConstraints = constraintsData;
  }

  renderTrainingPrefsPanel();
}

const DISCIPLINE_LABELS = { swim: 'Natation', bike: 'Vélo', run: 'Course', strength: 'Renfo' };
const DISCIPLINE_EMOJI = { swim: '🏊', bike: '🚴', run: '🏃', strength: '💪' };
const DISCIPLINE_OPTIONS = ['swim', 'bike', 'run', 'strength'];
// Renfo is deliberately excluded from the sport-priority ranking and from
// contrainte discipline pickers - it doesn't compete for rotation weight
// like swim/bike/run, it's a separate fixed-frequency question instead.
const CARDIO_DISCIPLINES = DISCIPLINE_OPTIONS.filter(d => d !== 'strength');

const DAY_LABELS = { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Jeu', fri: 'Ven', sat: 'Sam', sun: 'Dim' };
const DAY_OPTIONS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL_LIST = DAY_OPTIONS.map(d => DAY_LABELS[d]);

function pad2(n){ return String(n).padStart(2, '0'); }
function ymd(year, month, day){ return `${year}-${pad2(month + 1)}-${pad2(day)}`; }
function formatDateShort(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${FR_MONTHS[d.getMonth()].slice(0, 3)}`;
}

// Days outside [minDate, maxDate] (inclusive, "YYYY-MM-DD", either optional)
// are shown disabled and can't be picked. Today is always marked.
function calendarPanelHtml(viewYear, viewMonth, startDate, endDate, { minDate = null, maxDate = null } = {}){
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = ymdFromDate(new Date());

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<span class="calendar-day empty"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ymd(viewYear, viewMonth, day);
    const isStart = dateStr === startDate;
    const isEnd = dateStr === endDate;
    const inRange = startDate && endDate && dateStr > startDate && dateStr < endDate;
    const disabled = (minDate && dateStr < minDate) || (maxDate && dateStr > maxDate);
    const classes = ['calendar-day'];
    if (isStart || isEnd) classes.push('selected');
    if (inRange) classes.push('in-range');
    if (dateStr === todayStr) classes.push('today');
    const todayLabel = dateStr === todayStr ? ' aria-label="Aujourd\'hui"' : '';
    cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${dateStr}"${disabled ? ' disabled' : ''}${todayLabel}>${day}</button>`);
  }

  return `<div class="calendar-header">
      <button type="button" class="calendar-nav-btn" data-nav="prev" aria-label="Mois précédent">‹</button>
      <span class="calendar-month-label">${FR_MONTHS[viewMonth]} ${viewYear}</span>
      <button type="button" class="calendar-nav-btn" data-nav="next" aria-label="Mois suivant">›</button>
    </div>
    <div class="calendar-weekdays">${DAY_LABEL_LIST.map(l => `<span>${l}</span>`).join('')}</div>
    <div class="calendar-grid">${cells.join('')}</div>`;
}

function constraintRowHtml(constraint){
  const dates = `${formatDateShort(constraint.start_date)} → ${formatDateShort(constraint.end_date)}`;
  const disciplines = constraint.allowed_disciplines.length === 0
    ? 'Repos complet'
    : constraint.allowed_disciplines.map(d => `${DISCIPLINE_EMOJI[d] || ''} ${DISCIPLINE_LABELS[d] || d}`).join('  ');
  return `<div class="constraint-row" data-id="${constraint.id}">
    <div class="constraint-row-icon">🗓️</div>
    <div class="constraint-row-info">
      ${constraint.title ? `<div class="constraint-row-title">${escapeHtml(constraint.title)}</div>` : ''}
      <div class="constraint-row-dates">${escapeHtml(dates)}</div>
      <div class="constraint-row-disciplines">${escapeHtml(disciplines)}</div>
    </div>
    <button type="button" class="constraint-delete-btn" data-id="${constraint.id}" aria-label="Supprimer">✕</button>
  </div>`;
}

const WIZARD_STEP_LABELS = ['Course', 'Habitudes', 'Contraintes', 'Strava'];

function wizardStepsHtml(step){
  return `<div class="wizard-steps">${WIZARD_STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const stepHtml = `<div class="wizard-step${step >= n ? ' active' : ''}${step > n ? ' done' : ''}">
      <span class="wizard-step-num">${step > n ? '✓' : n}</span>
      <span class="wizard-step-label">${label}</span>
    </div>`;
    const lineHtml = n < WIZARD_STEP_LABELS.length ? `<div class="wizard-step-line${step > n ? ' done' : ''}"></div>` : '';
    return stepHtml + lineHtml;
  }).join('')}</div>`;
}

function dayPickerHtml(trainingDays){
  return DAY_OPTIONS.map(d => `<button type="button" class="picker-chip day-check-btn${trainingDays.includes(d) ? ' active' : ''}" data-day="${d}">
      <span class="picker-chip-label">${DAY_LABELS[d]}</span>
    </button>`).join('');
}

function sportPickerHtml(preferredDisciplines, chipClass, options = CARDIO_DISCIPLINES){
  return options.map(d => `<button type="button" class="picker-chip ${chipClass}${preferredDisciplines.includes(d) ? ' active' : ''}" data-discipline="${d}">
      <span class="picker-chip-icon">${DISCIPLINE_EMOJI[d]}</span>
      <span class="picker-chip-label">${DISCIPLINE_LABELS[d]}</span>
    </button>`).join('');
}

function strengthSliderLabel(count){
  return count === 0 ? 'Non' : `${count} fois / semaine`;
}

function strengthSliderHtml(count){
  return `<input type="range" min="0" max="5" step="1" value="${count}" class="strength-slider" id="strength-slider">
    <div class="strength-slider-label" id="strength-slider-label">${strengthSliderLabel(count)}</div>`;
}

// Three priority tiers rather than a strict ranking - several sports can
// share the same tier (equal priority), unlike an ordered list where every
// position is necessarily distinct.
const PRIORITY_LEVELS = [{ value: 1, label: 'Faible' }, { value: 2, label: 'Normale' }, { value: 3, label: 'Forte' }];
const DEFAULT_PRIORITY_LEVEL = 2;

function priorityListHtml(order, priorityMap){
  return order.map(d => `<div class="priority-row" data-discipline="${d}">
      <span class="priority-icon">${DISCIPLINE_EMOJI[d]}</span>
      <span class="priority-label">${DISCIPLINE_LABELS[d]}</span>
      <div class="priority-level-options">${PRIORITY_LEVELS.map(l => `<button type="button" class="priority-level-btn${(priorityMap[d] || DEFAULT_PRIORITY_LEVEL) === l.value ? ' active' : ''}" data-discipline="${d}" data-level="${l.value}">${l.label}</button>`).join('')}</div>
    </div>`).join('');
}

function prefsFieldsHtml(preferences){
  return `<div class="goal-field">
      <label>Jours d'entraînement</label>
      <div class="picker-grid day-picker-grid">${dayPickerHtml(preferences.training_days)}</div>
    </div>
    <div class="goal-field">
      <label>Sports pratiqués</label>
      <div class="picker-grid sport-picker-grid">${sportPickerHtml(preferences.preferred_disciplines, 'pref-discipline-btn')}</div>
      <div id="pref-priority-container"></div>
    </div>
    <div class="goal-field">
      <label>Renforcement</label>
      <div class="strength-slider-row">${strengthSliderHtml(preferences.strength_sessions_per_week || 0)}</div>
    </div>`;
}

// Réglages show the habits read-only; changing them is a deliberate
// "Modifier" -> "Enregistrer", followed by one recalculation prompt.
function habitsSummaryHtml(preferences){
  const order = preferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
  const priorityMap = Object.fromEntries(order.map(d => [d, preferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL]));
  const strength = preferences.strength_sessions_per_week || 0;
  const strengthDots = Array.from({ length: 5 }, (_, i) => `<span class="strength-dot${i < strength ? ' on' : ''}"></span>`).join('');
  // Same pieces as the editor, shown disabled, so reading and editing look
  // alike.
  return `<fieldset class="habits-readonly" disabled>
      <div class="goal-field">
        <label>Jours d'entraînement</label>
        <div class="picker-grid day-picker-grid">${dayPickerHtml(preferences.training_days)}</div>
      </div>
      <div class="goal-field">
        <label>Intensité par sport</label>
        ${order.length ? priorityListHtml(order, priorityMap) : '<p class="habits-empty">Aucun sport</p>'}
      </div>
      <div class="goal-field">
        <label>Renforcement</label>
        <div class="strength-readonly"><span class="strength-dots">${strengthDots}</span>${strengthSliderLabel(strength)}</div>
      </div>
    </fieldset>
    <button type="button" class="goal-save-btn btn-compact" id="habits-edit-btn">Modifier</button>`;
}

function contraintesSectionHtml(preferences, constraints, centerToggle = false){
  const startLabel = preferences.plan_start_date ? formatDateShort(preferences.plan_start_date) : 'Demain (par défaut)';
  // Once the plan has started, moving its start would rewrite the
  // athlete's history - it's fixed from then on.
  const started = hasGeneratedPlan() && preferences.plan_start_date && preferences.plan_start_date <= ymdFromDate(new Date());
  const startField = started
    ? `<p class="plan-start-fixed">📅 ${startLabel}<span>Le plan a commencé, sa date de début ne change plus.</span></p>`
    : `<button type="button" class="calendar-trigger-btn" id="plan-start-date-btn">📅 ${startLabel}</button>
      <div class="calendar-panel" id="plan-start-calendar-panel" hidden></div>`;
  return `<div class="goal-field">
      <label>Début du plan</label>
      ${startField}
    </div>

    <div class="constraint-list" id="constraint-list">${constraints.map(constraintRowHtml).join('')}</div>

    <button type="button" class="constraint-add-toggle-btn${centerToggle ? ' centered' : ''}" id="constraint-add-toggle-btn">
      <span class="constraint-add-toggle-icon">+</span>
      <span>Ajouter une contrainte</span>
    </button>
    <div class="constraint-add-form" id="constraint-add-form" hidden>
      <div class="goal-field">
        <label>Titre</label>
        <input type="text" id="new-constraint-title" placeholder="Vacances, blessure...">
      </div>
      <div class="goal-field">
        <label>Dates</label>
        <button type="button" class="calendar-trigger-btn" id="constraint-dates-btn">📅 Choisir les dates</button>
        <div class="calendar-panel" id="constraint-calendar-panel" hidden></div>
      </div>
      <div class="goal-field">
        <label>Disciplines autorisées</label>
        <div class="picker-grid sport-picker-grid small">${sportPickerHtml([], 'constraint-discipline-btn')}</div>
        <p class="constraint-hint">Aucune discipline choisie : repos complet sur ces dates.</p>
      </div>
      <div class="constraint-add-actions">
        <button type="button" class="goal-save-btn btn-compact" id="add-constraint-btn">Ajouter</button>
        <button type="button" class="constraint-cancel-btn" id="cancel-constraint-btn">Annuler</button>
      </div>
    </div>`;
}

// The race comes first: its date is the plan's end date, and its format
// picks the session presets and long-session distances.
function trainingPrefsRaceStepHtml(goals){
  return `<div class="wizard-card">
    <div class="wizard-hero">🏁</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Configurons ton plan</div>
    <p class="settings-sub" style="text-align:center;">Quelle course prépares-tu ? Le plan se termine le jour de la course.</p>
    ${wizardStepsHtml(1)}
    ${raceInfoFieldsHtml(goals, ymdFromDate(tomorrowDate()))}
    <p class="wizard-error" id="race-step-error" hidden></p>
    <button type="button" class="goal-save-btn wizard-next-btn" id="prefs-race-next-btn">Suivant →</button>
  </div>`;
}

function trainingPrefsStep1Html(preferences){
  return `<div class="wizard-card">
    <button type="button" class="wizard-back-link" id="prefs-back-btn">← Précédent</button>
    <div class="wizard-hero">🎯</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Tes habitudes</div>
    <p class="settings-sub" style="text-align:center;">Dis-nous quand et quoi tu aimes t'entraîner.</p>
    ${wizardStepsHtml(2)}
    ${prefsFieldsHtml(preferences)}
    <button type="button" class="goal-save-btn wizard-next-btn" id="prefs-next-btn">Suivant →</button>
  </div>`;
}

function trainingPrefsStep2Html(preferences, constraints){
  return `<div class="wizard-card">
    <button type="button" class="wizard-back-link" id="prefs-back-btn">← Précédent</button>
    <div class="wizard-hero">🗓️</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Des périodes particulières ?</div>
    <p class="settings-sub" style="text-align:center;">Vacances, blessure... ajoute des contraintes si besoin.</p>
    ${wizardStepsHtml(3)}
    ${contraintesSectionHtml(preferences, constraints, true)}
    <p class="wizard-error" id="contraintes-step-error" hidden></p>
    <button type="button" class="goal-save-btn wizard-next-btn" id="prefs-step2-next-btn" style="margin-top:24px;">Suivant →</button>
  </div>`;
}

function trainingPrefsStep3Html(){
  return `<div class="wizard-card">
    <button type="button" class="wizard-back-link" id="prefs-back-btn">← Précédent</button>
    <div class="wizard-hero">🔗</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Connecte Strava</div>
    <p class="settings-sub" style="text-align:center;">Pour comparer tes séances planifiées à tes vraies activités (facultatif).</p>
    ${wizardStepsHtml(4)}
    <div id="wizard-strava-status"><p class="settings-status">Chargement de Strava…</p></div>
    <button type="button" class="goal-save-btn wizard-next-btn" id="prefs-finish-btn" style="margin-top:24px;">Terminer ✓</button>
  </div>`;
}

function prefsCardHtml(icon, title, subtitle, bodyHtml, openByDefault = false){
  return `<details class="prefs-card"${openByDefault ? ' open' : ''}>
    <summary class="prefs-card-header">
      <span class="prefs-card-icon">${icon}</span>
      <div class="prefs-card-header-text">
        <div class="prefs-card-title">${title}</div>
        <p class="prefs-card-subtitle">${subtitle}</p>
      </div>
      <svg class="chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
    </summary>
    <div class="prefs-card-body">${bodyHtml}</div>
  </details>`;
}

function activeGeneratedWeek(weeks, weekNumbers){
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  for (const wn of weekNumbers) {
    const dates = weeks.get(wn).map(s => s.session_date).filter(Boolean);
    if (dates.length === 0) continue;
    const end = dates.reduce((a, b) => a > b ? a : b);
    if (todayStr <= end) return wn; // first week not yet fully in the past
  }
  return weekNumbers[weekNumbers.length - 1];
}

const PHASE_NAMES = { 1: 'Base', 2: 'Développement', 3: 'Spécifique', 4: 'Affûtage' };
const PHASE_GOALS = {
  1: "Construire le volume et les bases d'endurance.",
  2: "Augmenter progressivement l'intensité.",
  3: 'Se rapprocher des allures cibles de la course.',
  4: 'Réduire le volume, garder un peu d\'intensité.',
};
const PHASE_ICONS = { 1: '🌱', 2: '📈', 3: '🎯', 4: '⚡' };
const PHASE_COLORS = { 1: '#4F7A73', 2: '#0E6E8C', 3: '#4A4E8C', 4: 'var(--coral)' };

function betaPlanSectionHtml(){
  if (sessionsByKey.size === 0) return '';

  const weeks = new Map();
  for (const s of sessionsByKey.values()) {
    if (!weeks.has(s.week_number)) weeks.set(s.week_number, []);
    weeks.get(s.week_number).push(s);
  }
  const weekNumbers = Array.from(weeks.keys()).sort((a, b) => a - b);
  // Computed from this plan's own session dates rather than
  // currentWeekNumber(), which is tied to WEEK_DATE_RANGES - the real
  // hand-written plan's calendar, unrelated to a generated plan's dates.
  const activeWeek = activeGeneratedWeek(weeks, weekNumbers);

  const byPhase = new Map();
  for (const wn of weekNumbers) {
    const phase = weeks.get(wn)[0].phase;
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push(wn);
  }

  const body = Array.from(byPhase.keys()).sort((a, b) => a - b).map(phase => {
    const weeksHtml = byPhase.get(phase).map(wn => weekBlockHtml(wn, weeks.get(wn), wn === activeWeek)).join('');
    const color = PHASE_COLORS[phase] || 'var(--ink)';
    return `<div class="plan-phase-group" style="--phase-color:${color}">
      <div class="plan-phase-head">
        <span class="plan-phase-icon">${PHASE_ICONS[phase] || ''}</span>
        <div>
          <h3>Phase ${phase} - ${PHASE_NAMES[phase] || ''}</h3>
          <p class="plan-phase-goal">${PHASE_GOALS[phase] || ''}</p>
        </div>
      </div>
      <div class="plan-phase-weeks">${weeksHtml}</div>
    </div>`;
  }).join('');

  return `<div class="detail-title" style="margin:24px 0 12px;">Ton plan</div>${body}`;
}

function trainingPrefsFullFormHtml(preferences, constraints){
  return prefsCardHtml('🎯', 'Habitudes', "Jours d'entraînement et sports pratiqués.",
    '<div id="habits-view"></div>')
    + prefsCardHtml('🗓️', 'Contraintes', 'Vacances, blessures, périodes particulières.',
    contraintesSectionHtml(preferences, constraints))
    + betaPlanSectionHtml()
    + resetPlanSectionHtml();
}

function resetPlanSectionHtml(){
  return `<div class="reset-plan-zone">
    <button type="button" id="reset-plan-btn" class="reset-plan-btn">Réinitialiser le plan</button>
    <p class="reset-plan-hint">Supprime les séances générées, tes habitudes et tes contraintes pour recommencer l'onboarding à zéro.</p>
  </div>`;
}

function renderConstraintList(){
  const list = document.getElementById('constraint-list');
  if (!list) return;
  list.innerHTML = currentConstraints.map(constraintRowHtml).join('');
  list.querySelectorAll('.constraint-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteConstraint(Number(btn.dataset.id)));
  });
}

async function deleteConstraint(id){
  const { error } = await supabase.from('plan_constraints').delete().eq('id', id);
  if (error) {
    console.error('Erreur de suppression de la contrainte', error);
    return;
  }
  currentConstraints = currentConstraints.filter(c => c.id !== id);
  renderConstraintList();
  askReplan();
}

function toggleChipGroup(selector, selectedSet, datasetKey, onChange){
  document.querySelectorAll(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset[datasetKey];
      if (selectedSet.has(value)) {
        selectedSet.delete(value);
        btn.classList.remove('active');
      } else {
        selectedSet.add(value);
        btn.classList.add('active');
      }
      if (onChange) onChange();
    });
  });
}

// Wires the sport picker chips together with the "priority" reorder list
// below them: order (mutated in place) reflects selection order, and can be
// nudged with the up/down arrows. Used both by the algorithm (to weight
// which sports get more sessions when days/sports counts don't match) and
// as the saved preferred_disciplines order.
function wirePreferredDisciplines(order, priorityMap, onChange){
  function renderPriorityList(){
    const container = document.getElementById('pref-priority-container');
    if (!container) return;
    container.innerHTML = order.length > 1
      ? `<p class="priority-hint">Quelle intensité veux-tu mettre pour chaque sport ?<span class="priority-hint-sub">Plusieurs sports peuvent avoir la même intensité.</span></p>${priorityListHtml(order, priorityMap)}`
      : '';
    container.querySelectorAll('.priority-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        priorityMap[btn.dataset.discipline] = Number(btn.dataset.level);
        renderPriorityList();
        if (onChange) onChange();
      });
    });
  }

  document.querySelectorAll('.pref-discipline-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.discipline;
      const idx = order.indexOf(d);
      if (idx === -1) {
        order.push(d);
        priorityMap[d] = DEFAULT_PRIORITY_LEVEL;
        btn.classList.add('active');
      } else {
        order.splice(idx, 1);
        delete priorityMap[d];
        btn.classList.remove('active');
      }
      renderPriorityList();
      if (onChange) onChange();
    });
  });

  renderPriorityList();
}

// A single 0-5 slider for Renfo frequency - a separate question from the
// sport priority ranking, not another entry competing in it.
function wireStrengthFrequency(state, onChange){
  const slider = document.getElementById('strength-slider');
  const label = document.getElementById('strength-slider-label');
  if (!slider) return;

  slider.addEventListener('input', () => {
    label.textContent = strengthSliderLabel(Number(slider.value));
  });
  slider.addEventListener('change', () => {
    state.value = Number(slider.value);
    if (onChange) onChange();
  });
}

function isPrefsConfigured(){
  return currentPreferences.training_days.length > 0 && currentPreferences.preferred_disciplines.length > 0;
}

let trainingPrefsStep = 1;
// Whether the user has completed the wizard at least once. Tracked
// separately from isPrefsConfigured() so that saving step 1 (which fills in
// training_days/preferred_disciplines) doesn't make the wizard immediately
// think onboarding is done and skip straight past step 2.
let trainingPrefsOnboardingDone = null;

function wirePlanStartDatePicker(){
  const btn = document.getElementById('plan-start-date-btn');
  const panel = document.getElementById('plan-start-calendar-panel');
  if (!btn || !panel) return;

  let selectedDate = currentPreferences.plan_start_date;
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  // The plan can't start in the past, nor on or after race day.
  const minDate = ymdFromDate(new Date());
  let maxDate = null;
  if (currentGoals?.race_date) {
    const dayBeforeRace = new Date(currentGoals.race_date + 'T00:00:00');
    dayBeforeRace.setDate(dayBeforeRace.getDate() - 1);
    maxDate = ymdFromDate(dayBeforeRace);
  }

  function render(){
    panel.innerHTML = calendarPanelHtml(viewYear, viewMonth, selectedDate, null, { minDate, maxDate });

    panel.querySelector('[data-nav="prev"]').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    panel.querySelector('[data-nav="next"]').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    panel.querySelectorAll('.calendar-day:not(.empty):not(:disabled)').forEach(cell => {
      cell.addEventListener('click', async () => {
        selectedDate = cell.dataset.date;
        btn.textContent = `📅 ${formatDateShort(selectedDate)}`;
        panel.hidden = true;

        const updated = { ...currentPreferences, plan_start_date: selectedDate, updated_at: new Date().toISOString() };
        const { error } = await supabase.from('plan_preferences').upsert(updated);
        if (error) {
          console.error('Erreur de sauvegarde du début du plan', error);
          return;
        }
        currentPreferences = updated;
        askReplan();
      });
    });
  }

  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) render();
  });
}

function wireContraintesSection(){
  wirePlanStartDatePicker();

  const selectedConstraintDisciplines = new Set();
  toggleChipGroup('.constraint-discipline-btn', selectedConstraintDisciplines, 'discipline');

  let constraintStart = null;
  let constraintEnd = null;
  const today = new Date();
  let calendarViewYear = today.getFullYear();
  let calendarViewMonth = today.getMonth();

  function updateDatesButtonLabel(){
    const btn = document.getElementById('constraint-dates-btn');
    if (constraintStart && constraintEnd) {
      btn.textContent = `${formatDateShort(constraintStart)} → ${formatDateShort(constraintEnd)}`;
    } else if (constraintStart) {
      btn.textContent = `${formatDateShort(constraintStart)} → …`;
    } else {
      btn.textContent = 'Choisir les dates';
    }
  }

  function renderCalendar(){
    const panel = document.getElementById('constraint-calendar-panel');
    panel.innerHTML = calendarPanelHtml(calendarViewYear, calendarViewMonth, constraintStart, constraintEnd);

    panel.querySelector('[data-nav="prev"]').addEventListener('click', () => {
      calendarViewMonth--;
      if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
      renderCalendar();
    });
    panel.querySelector('[data-nav="next"]').addEventListener('click', () => {
      calendarViewMonth++;
      if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
      renderCalendar();
    });
    panel.querySelectorAll('.calendar-day:not(.empty)').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        if (!constraintStart || constraintEnd || dateStr < constraintStart) {
          constraintStart = dateStr;
          constraintEnd = null;
        } else {
          constraintEnd = dateStr;
        }
        updateDatesButtonLabel();
        renderCalendar();
        if (constraintStart && constraintEnd) panel.hidden = true;
      });
    });
  }

  document.getElementById('constraint-dates-btn').addEventListener('click', () => {
    const panel = document.getElementById('constraint-calendar-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderCalendar();
  });

  function resetConstraintForm(){
    constraintStart = null;
    constraintEnd = null;
    updateDatesButtonLabel();
    document.getElementById('constraint-calendar-panel').hidden = true;
    document.getElementById('new-constraint-title').value = '';
    selectedConstraintDisciplines.clear();
    document.querySelectorAll('.constraint-discipline-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('constraint-add-form').hidden = true;
    document.getElementById('constraint-add-toggle-btn').hidden = false;
  }

  document.getElementById('constraint-add-toggle-btn').addEventListener('click', () => {
    document.getElementById('constraint-add-toggle-btn').hidden = true;
    document.getElementById('constraint-add-form').hidden = false;
  });

  document.getElementById('cancel-constraint-btn').addEventListener('click', resetConstraintForm);

  document.getElementById('add-constraint-btn').addEventListener('click', async () => {
    if (!constraintStart || !constraintEnd) return;

    const title = document.getElementById('new-constraint-title').value.trim() || null;
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.from('plan_constraints').insert({
      user_id: session?.user?.id,
      start_date: constraintStart,
      end_date: constraintEnd,
      allowed_disciplines: Array.from(selectedConstraintDisciplines),
      title,
    }).select().single();

    if (error) {
      console.error('Erreur d\'ajout de la contrainte', error);
      return;
    }
    currentConstraints = [...currentConstraints, data].sort((a, b) => a.start_date.localeCompare(b.start_date));
    renderConstraintList();
    resetConstraintForm();
    askReplan();
  });
}

// Tempo/Seuil/Fractionné presets per discipline and race size, transcribed
// from the decision trees. `min` is a curated approximate main-set duration
// (not runtime-parsed from the text - formats like "8x30/30" or "6x400m"
// aren't reliably parseable without pace assumptions, so these are
// hand-estimated). The lowest-`min` entry in each type is used during
// taper instead of continuing the normal cycle. Tempo is always blocks of
// minutes and Fractionné always repetitions of a distance, for both sports:
// the trees' continuous Tempo efforts, distance-based run Tempo and
// time-based bike Fractionné were rewritten to that shape, keeping roughly
// the same main-set volume so the light-to-hard ranking holds.
const SESSION_FORMATS = {
  bike: {
    M: {
      Tempo: [
        { text: '3x15min', min: 50 },
        { text: '4x10min', min: 45 },
        { text: '2x15min', min: 30 },
        { text: '2x20min', min: 40 },
      ],
      Seuil: [
        { text: '3x10min', min: 35 },
        { text: '4x8min', min: 36 },
        { text: '3x12min', min: 40 },
        { text: '2x18min', min: 40 },
      ],
      Fractionné: [
        { text: '6x1.5km', min: 25 },
        { text: '8x300m', min: 10 },
        { text: '5x2km', min: 25 },
        { text: '10x1km', min: 25 },
      ],
    },
    S: {
      Tempo: [
        { text: '2x10min', min: 24 },
        { text: '3x7min', min: 25 },
        { text: '4x5min', min: 20 },
        { text: '5x5min', min: 25 },
      ],
      Seuil: [
        { text: '3x6min', min: 22 },
        { text: '4x5min', min: 24 },
        { text: '2x8min', min: 18 },
        { text: '1x12min', min: 12 },
      ],
      Fractionné: [
        { text: '5x1km', min: 14 },
        { text: '6x200m', min: 8 },
        { text: '4x1.5km', min: 16 },
        { text: '8x500m', min: 14 },
      ],
    },
  },
  run: {
    M: {
      Tempo: [
        { text: '3x10min', min: 30 },
        { text: '4x8min', min: 32 },
        { text: '2x12min', min: 24 },
        { text: '3x12min', min: 36 },
      ],
      Seuil: [
        { text: '4x1.5km', min: 30 },
        { text: '5x1km', min: 26 },
        { text: '3x2.5km', min: 35 },
        { text: '2x4km', min: 37 },
      ],
      Fractionné: [
        { text: '6x400m', min: 18 },
        { text: '5x1000m', min: 24 },
        { text: '10x300m', min: 18 },
        { text: '8x500m', min: 24 },
      ],
    },
    S: {
      Tempo: [
        { text: '3x6min', min: 18 },
        { text: '2x8min', min: 16 },
        { text: '3x5min', min: 15 },
        { text: '2x10min', min: 20 },
      ],
      Seuil: [
        { text: '4x750m', min: 16 },
        { text: '3x1km', min: 14 },
        { text: '2x2km', min: 18 },
        { text: '6x300m', min: 14 },
      ],
      Fractionné: [
        { text: '6x300m', min: 14 },
        { text: '4x800m', min: 20 },
        { text: '8x200m', min: 13 },
        { text: '5x400m', min: 13 },
      ],
    },
  },
};

const CARDIO_WARMUP_COOLDOWN = {
  bike: { warmup: 20, cooldown: 10 },
  run: { warmup: 25, cooldown: 10 },
};

function tomorrowDate(){
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function ymdFromDate(d){
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

function planStartDate(){
  return currentPreferences.plan_start_date
    ? new Date(currentPreferences.plan_start_date + 'T00:00:00')
    : tomorrowDate();
}

// Effort zones shown on each session segment, described by feel (breathing
// and how much you can talk) since the app has no heart-rate or pace data.
const ZONES = {
  Z1: { name: 'Très facile', feel: 'Respiration calme, tu peux parler sans effort.' },
  Z2: { name: 'Endurance', feel: 'Confortable, tu peux tenir une conversation.' },
  Z3: { name: 'Tempo', feel: 'Soutenu mais contrôlé, seulement des phrases courtes.' },
  Z4: { name: 'Seuil', feel: 'Dur mais tenable plusieurs minutes, seulement quelques mots.' },
  Z5: { name: 'Fractionné', feel: 'Très dur, sur des efforts courts, impossible de parler.' },
};
const ZONE_FOR_TYPE = { 'Sortie longue': 'Z2', Tempo: 'Z3', Seuil: 'Z4', Fractionné: 'Z5' };
const KEY_PACE = { name: 'Allure cible', feel: 'Allure que tu vises le jour de la course.' };

// Season template for a full plan (16 weeks), read backward from the race -
// the structure borrows from yootri's block model (github.com/nandocfz/yootri).
// `ramp` is the load across the block's loading weeks, as a share of the
// season's heaviest week; 4-week blocks end on a recovery week at `recovery`.
// `presetLevel` picks which of a type's tree presets to use, ranked lightest
// (0) to hardest (3).
const SEASON_BLOCKS = [
  { name: 'Base 1', phase: 1, weeks: 4, ramp: [0.70, 0.75], recovery: 0.60, presetLevel: 0 },
  { name: 'Base 2', phase: 1, weeks: 4, ramp: [0.80, 0.85], recovery: 0.65, presetLevel: 1 },
  { name: 'Développement', phase: 2, weeks: 4, ramp: [0.90, 1.00], recovery: 0.70, presetLevel: 2 },
  { name: 'Spécifique', phase: 3, weeks: 2, ramp: [1.00, 0.90], presetLevel: 3 },
  { name: 'Affûtage', phase: 4, weeks: 1, ramp: [0.70, 0.70], presetLevel: 0 },
  { name: 'Course', phase: 4, weeks: 1, ramp: [0.50, 0.50], presetLevel: 0, raceWeek: true },
];

function expandSeasonBlock(block){
  const loadingWeeks = block.recovery != null ? block.weeks - 1 : block.weeks;
  return Array.from({ length: block.weeks }, (_, i) => {
    const recovery = block.recovery != null && i === block.weeks - 1;
    const [low, high] = block.ramp;
    const load = recovery
      ? block.recovery
      : loadingWeeks === 1 ? low : low + (high - low) * i / (loadingWeeks - 1);
    return { ...block, weekInBlock: i + 1, recovery, load };
  });
}

// Lands the template on a plan of `weeksTotal` weeks ending on race week. A
// shorter plan drops weeks from the front (taper and specific work are what
// can't be skipped); a longer one pads the front with extra Base weeks,
// repeating Base 1's 3+1 pattern so the padding ends on a recovery week.
function fitSeasonToRace(weeksTotal){
  const full = SEASON_BLOCKS.flatMap(expandSeasonBlock);
  if (weeksTotal <= full.length) return full.slice(full.length - weeksTotal);
  const baseCycle = expandSeasonBlock(SEASON_BLOCKS[0]).map(w => ({ ...w, name: 'Base' }));
  const padLength = weeksTotal - full.length;
  const pad = Array.from({ length: padLength }, (_, i) => {
    const cycleIndex = ((i - padLength) % baseCycle.length + baseCycle.length) % baseCycle.length;
    return { ...baseCycle[cycleIndex], presetLevel: 0 };
  });
  return pad.concat(full);
}

// Peak long session, as a multiple of the race distance. Every other week's
// long session is this x the week's load.
const LONG_SESSION_RATIO = { S: { bike: 2, run: 1.6 }, M: { bike: 1.5, run: 1.2 } };
const STRENGTH_DURATION = 30;

// Swim sessions are built like a coach's pool session: warm-up, drills,
// a main set given by the session's objective, cool-down - all in metres.
// The long swim aims at peak distance x the week's load; the others take
// their main set from presets (SWIM_FORMATS).
const SWIM_PEAK_DISTANCE_M = { S: 2000, M: 3000 };
const SWIM_OBJECTIVE = {
  endurance: 'Endurance',
  seuil: 'Seuil',
  vitesse: 'Vitesse',
  technique: 'Technique',
};
// Développement/Spécifique key swims alternate these, counted over the plan
// like bike/run key sessions (see KEY_PARTNER_BY_BLOCK).
const SWIM_KEY_ALTERNATION = [SWIM_OBJECTIVE.seuil, SWIM_OBJECTIVE.vitesse];

// Gear assumed: kickboard, pull-buoy (PB) and paddles - no fins or snorkel.
// Drills are never named: the athlete picks them from the exercise library.
const SWIM_DRILL_CHOICE = 'éducatifs au choix dans la bibliothèque';
const SWIM_WARMUP_M = 200;
const SWIM_COOLDOWN_M = 50; // "50 à 200", counted at its minimum

const swimReps = (budget, unit, min, max) => Math.max(min, Math.min(max, Math.round(budget / unit)));

// The long swim (Endurance) is sized like a bike/run long session: its
// blocks stretch or shrink with the week's volume. It takes the metres left
// for its main set and whether the week is light (recovery/taper), and
// returns its lines and actual distance.
function swimEnduranceSet(budget, light){
  const blocks = swimReps(budget - 400, 600, 1, light ? 1 : 3);
  const finalM = Math.max(200, Math.min(600, Math.floor((budget - blocks * 600) / 100) * 100));
  return {
    meters: blocks * 600 + finalM,
    lines: [
      blocks === 1 ? 'Bloc :' : `Bloc, ${blocks} fois :`,
      '- 100 Z2 (r = 15″)',
      '- 200 Z3 avec PB + plaquettes (r = 20″)',
      '- 2×100 Z4 (r = 10″)',
      '- 100 Z1 (r = 15″)',
      `${finalM} Z3 (r = 45″)`,
    ],
  };
}

// The other swims use presets like bike/run (see SESSION_FORMATS), listed
// lightest first and picked by pickFormat. `m` is the main set's distance.
const SWIM_FORMATS = {
  M: {
    [SWIM_OBJECTIVE.technique]: [
      { text: '8x100m', m: 800, detail: 'Z2 : 50 m jambes avec planche - 50 m nage complète (r = 15″)' },
      { text: '5x200m', m: 1000, detail: 'Z2, 1 sur 2 avec PB (r = 20″)' },
      { text: '4x300m', m: 1200, detail: 'Z2, le dernier avec PB + plaquettes (r = 20″)' },
      { text: '3x400m', m: 1200, detail: 'Z2, 1 sur 2 avec PB (r = 30″)' },
    ],
    [SWIM_OBJECTIVE.seuil]: [
      { text: '8x100m', m: 800, detail: 'Z4 (r = 15″)' },
      { text: '6x200m', m: 1200, detail: 'Z4 (r = 20″)' },
      { text: '4x300m', m: 1200, detail: 'Z4 (r = 30″)' },
      { text: '4x400m', m: 1600, detail: 'Z4 (r = 30″)' },
    ],
    [SWIM_OBJECTIVE.vitesse]: [
      { text: '12x50m', m: 600, detail: 'Z5 (r = 30″)' },
      { text: '16x50m', m: 800, detail: 'Z5 (r = 30″)' },
      { text: '10x100m', m: 1000, detail: 'Z5 (r = 40″)' },
      { text: '12x100m', m: 1200, detail: 'Z5 (r = 40″)' },
    ],
  },
  S: {
    [SWIM_OBJECTIVE.technique]: [
      { text: '6x100m', m: 600, detail: 'Z2 : 50 m jambes avec planche - 50 m nage complète (r = 15″)' },
      { text: '4x200m', m: 800, detail: 'Z2, 1 sur 2 avec PB (r = 20″)' },
      { text: '3x300m', m: 900, detail: 'Z2, le dernier avec PB + plaquettes (r = 20″)' },
      { text: '5x200m', m: 1000, detail: 'Z2, 1 sur 2 avec PB (r = 20″)' },
    ],
    [SWIM_OBJECTIVE.seuil]: [
      { text: '6x100m', m: 600, detail: 'Z4 (r = 15″)' },
      { text: '5x150m', m: 750, detail: 'Z4 (r = 20″)' },
      { text: '4x200m', m: 800, detail: 'Z4 (r = 20″)' },
      { text: '3x300m', m: 900, detail: 'Z4 (r = 30″)' },
    ],
    [SWIM_OBJECTIVE.vitesse]: [
      { text: '8x50m', m: 400, detail: 'Z5 (r = 30″)' },
      { text: '12x50m', m: 600, detail: 'Z5 (r = 30″)' },
      { text: '6x100m', m: 600, detail: 'Z5 (r = 40″)' },
      { text: '8x100m', m: 800, detail: 'Z5 (r = 40″)' },
    ],
  },
};

// A sport's sessions in a week take roles in order: its 1st is the long
// session, its 2nd the key session, the rest are complements. What each role
// means depends on the phase (see cardioTypeFor / swimTypeFor); `null` means
// the role has no session that week (the day is left free).
function cardioTypeFor(week, role){
  if (week.raceWeek) return role === 'clé' ? 'Allure cible' : null;
  if (role === 'longue') return 'Sortie longue';
  // Key sessions of Base 2, Développement and Spécifique are swapped for
  // their alternation in buildGeneratedPlan.
  switch (week.phase) {
    case 1: return 'Tempo';
    case 2: return role === 'clé' ? 'Seuil' : 'Tempo';
    case 3: return role === 'clé' ? 'Allure cible' : 'Tempo';
    default: return role === 'clé' ? 'Allure cible' : null; // taper: no complements
  }
}

// In Base 2 and Développement, a sport's key sessions (bike/run) alternate
// Fractionné and the block's other key type, starting with Fractionné. The
// alternation is counted per sport by its own key sessions across both
// blocks (not by week, not restarting each block): a sport with one session
// a week only gets its key session every other week, and any week-based or
// per-block alternation could land it on the same type every time. Recovery
// weeks always get a Tempo instead and don't count, so they never eat a
// Fractionné. Fractionné comes in gently in Base (lightest presets, see
// pickFormat).
const KEY_PARTNER_BY_BLOCK = {
  'Base 2': 'Tempo',
  'Développement': 'Seuil',
};
// Spécifique is about race pace: its key sessions alternate these, counted
// within the block and starting with Allure cible, so even a sport with a
// single key session there gets its race-pace work.
const SPECIFIC_KEY_ALTERNATION = ['Allure cible', 'Fractionné'];

// Race-pace ("allure cible") main sets, sized from the race format. `reps`
// grows from the first to the second Spécifique week; the taper uses
// `taperReps`, race week a short reminder.
const KEY_PACE_SETS = {
  run: {
    S: { rep: '1 km', reps: [4, 5], taperReps: 3, rest: '1′30', raceWeek: '3×500 m', longFinishKm: 1.5 },
    M: { rep: '2 km', reps: [3, 4], taperReps: 2, rest: '2′', raceWeek: '3×1 km', longFinishKm: 3 },
  },
  bike: {
    S: { rep: '5 km', reps: [2, 3], taperReps: 2, rest: '3′', raceWeek: '3×2 km', longFinishKm: 5 },
    M: { rep: '10 km', reps: [2, 3], taperReps: 2, rest: '5′', raceWeek: '3×3 km', longFinishKm: 10 },
  },
};

// Swim "type" is the session's objective. Développement/Spécifique key swims
// are swapped for SWIM_KEY_ALTERNATION in buildGeneratedPlan.
function swimTypeFor(week, role){
  if (week.raceWeek) return role === 'clé' ? SWIM_OBJECTIVE.endurance : null;
  if (role === 'longue') return SWIM_OBJECTIVE.endurance;
  if (role === 'clé') {
    if (week.phase === 1) return SWIM_OBJECTIVE.technique;
    return SWIM_OBJECTIVE.seuil;
  }
  return week.phase === 4 ? null : SWIM_OBJECTIVE.technique;
}

// A sport with a single session that week can't be long *and* key, so its
// role alternates week to week - offset between sports, so the week still
// holds a mix (bike long while run does its key session, then the reverse).
const SINGLE_SESSION_ROTATION = {
  1: ['longue', 'clé'],
  2: ['longue', 'clé'],
  3: ['clé', 'longue'],
  4: ['longue', 'clé'],
};
const SINGLE_SESSION_OFFSET = { bike: 0, run: 1, swim: 0 };

// Long sessions claim their days first, bike first, so the long ride gets
// the weekend before anything else does.
const ROLE_PLACEMENT_ORDER = ['longue', 'clé', 'complément'];
const LONG_PLACEMENT_ORDER = ['bike', 'run', 'swim'];

function buildGeneratedPlan(){
  const trainingDays = DAY_OPTIONS.filter(d => currentPreferences.training_days.includes(d));
  // Order matters here: preferred_disciplines is saved in priority order
  // (highest priority first), used to break ties below. Renfo never takes
  // part in the weekly split - it's scheduled separately at the end.
  const disciplines = currentPreferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
  if (trainingDays.length === 0 || disciplines.length === 0) return [];

  // The race date is the plan's end: no race date (or a race before the
  // start) means there's nothing to build toward, so no plan.
  const planStart = planStartDate();
  const raceDate = currentGoals?.race_date ? new Date(currentGoals.race_date + 'T00:00:00') : null;
  if (!raceDate || raceDate <= planStart) return [];

  // Weeks are always real Monday-Sunday calendar weeks, not rolling periods
  // from planStart. If planStart isn't a Monday, week 1 is simply a short
  // partial week, and week 2 properly starts on the next Monday.
  const planStartDow = (planStart.getDay() + 6) % 7; // 0 = Monday, ..., 6 = Sunday
  const firstMonday = new Date(planStart);
  firstMonday.setDate(planStart.getDate() - planStartDow);

  // Every training day from the start up to the day before the race (no
  // session on race day itself), grouped by week. The last week is the race
  // week; a Monday race counts the week before it as race week instead of
  // leaving an empty one.
  const weekDays = new Map(); // weekNumber -> [{ date, dateStr, dayIndex }]
  const trainingDaySet = new Set(trainingDays);
  const totalDays = Math.round((raceDate - planStart) / 86400000);
  let weeksTotal = 0;
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = new Date(planStart);
    date.setDate(planStart.getDate() + dayIndex);
    const daysSinceFirstMonday = Math.round((date - firstMonday) / 86400000);
    const weekNumber = Math.floor(daysSinceFirstMonday / 7) + 1;
    weeksTotal = weekNumber;
    if (!trainingDaySet.has(DAY_OPTIONS[(date.getDay() + 6) % 7])) continue;
    if (!weekDays.has(weekNumber)) weekDays.set(weekNumber, []);
    weekDays.get(weekNumber).push({ date, dateStr: ymd(date.getFullYear(), date.getMonth(), date.getDate()), dayIndex });
  }

  const season = fitSeasonToRace(weeksTotal);
  const raceSize = currentGoals?.size === 'S' ? 'S' : 'M';
  const disciplineWeights = disciplines.map(d => currentPreferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL);

  function constraintForDate(dateStr){
    return currentConstraints.find(c => dateStr >= c.start_date && dateStr <= c.end_date);
  }

  // How many sessions each sport gets this week, by the intensity the
  // athlete wants for it (Forte x3, Normale x2, Faible x1). Both cases use a smooth weighted round-robin whose
  // credit carries over from week to week - restarting it each week would
  // settle ties between sports of the same priority the same way every week.
  //
  // With at least one day per sport, every sport gets one session, and the
  // extra days go by each sport's share of the week *beyond* that first
  // session: its fair share of all training days (days x weight / total)
  // minus 1. So with 4 days, swim and run on Forte and bike on Faible, the extra
  // day alternates between swim and run, and bike - whose fair share is
  // under one session - never gets it.
  //
  // With fewer days than sports, the round-robin runs on the priority
  // weights themselves, so lower-priority sports still come up in turn.
  const weightTotal = disciplineWeights.reduce((a, b) => a + b, 0);
  const extraWeights = disciplineWeights.map(w => Math.max(0, trainingDays.length * w / weightTotal - 1));
  const extraWeightTotal = extraWeights.reduce((a, b) => a + b, 0);
  const extraCredit = new Array(disciplines.length).fill(0);
  const shortWeekCredit = new Array(disciplines.length).fill(0);
  function roundRobin(counts, credit, weights, total, picks){
    for (let p = 0; p < picks; p++) {
      weights.forEach((w, i) => { credit[i] += w; });
      const chosen = credit.reduce((best, c, i) => c > credit[best] ? i : best, 0);
      credit[chosen] -= total;
      counts[chosen]++;
    }
  }
  function sessionCounts(dayCount){
    const counts = new Array(disciplines.length).fill(0);
    if (dayCount >= disciplines.length) {
      counts.fill(1);
      const extras = dayCount - disciplines.length;
      if (extras > 0 && extraWeightTotal > 0) roundRobin(counts, extraCredit, extraWeights, extraWeightTotal, extras);
    } else {
      roundRobin(counts, shortWeekCredit, disciplineWeights, weightTotal, dayCount);
    }
    return counts;
  }

  function rolesFor(discipline, count, weekNumber, week){
    if (count === 0) return [];
    if (count === 1) {
      if (week.raceWeek) return ['clé'];
      const rotation = SINGLE_SESSION_ROTATION[week.phase];
      return [rotation[(weekNumber + SINGLE_SESSION_OFFSET[discipline]) % rotation.length]];
    }
    return ['longue', 'clé', ...Array(count - 2).fill('complément')];
  }

  function typeFor(discipline, week, role){
    return discipline === 'swim' ? swimTypeFor(week, role) : cardioTypeFor(week, role);
  }

  // Greedy placement, one session per day: each session takes the free day
  // with the lowest penalty (earliest day on ties).
  function placeWeek(sessions, days){
    const isWeekend = day => day.date.getDay() === 0 || day.date.getDay() === 6;
    const adjacent = (a, b) => Math.abs(a.dayIndex - b.dayIndex) === 1;
    const placed = [];
    const ordered = [...sessions].sort((a, b) =>
      ROLE_PLACEMENT_ORDER.indexOf(a.role) - ROLE_PLACEMENT_ORDER.indexOf(b.role)
      || LONG_PLACEMENT_ORDER.indexOf(a.discipline) - LONG_PLACEMENT_ORDER.indexOf(b.discipline));

    for (const session of ordered) {
      const free = days.filter(day => !placed.some(p => p.day === day));
      if (free.length === 0) break;
      const penalty = day => {
        const neighbours = placed.filter(p => adjacent(p.day, day));
        let score = 0;
        if (neighbours.some(p => p.discipline === session.discipline)) score += 10;
        if (session.role === 'clé' && neighbours.some(p => p.role === 'clé')) score += 5;
        if (session.role === 'longue' && !isWeekend(day)) score += 3;
        if (session.role === 'clé' && isWeekend(day)) score += 2;
        return score;
      };
      const day = free.reduce((best, d) => penalty(d) < penalty(best) ? d : best, free[0]);
      placed.push({ ...session, day });
    }
    return placed;
  }

  // Presets are ranked by the curated `min` (used only to rank variants, not
  // to display a duration). For variety, each block alternates between two
  // neighbouring presets - its own level and the next one up (the two
  // hardest at the top, hardest first) - so sessions change within a block
  // while still getting harder block to block. Recovery weeks and the taper
  // use a single light preset; Fractionné in Base (its introduction)
  // alternates between the two lightest.
  const formatOccurrence = {};
  function pickFormat(discipline, type, week){
    const ranked = discipline === 'swim'
      ? SWIM_FORMATS[raceSize][type]
      : [...SESSION_FORMATS[discipline][raceSize][type]].sort((a, b) => a.min - b.min);
    const top = ranked.length - 1;
    let choices;
    if (week.phase === 4) choices = [0];
    else if (week.recovery) choices = [Math.max(0, week.presetLevel - 1)];
    else if (week.phase === 1 && type === 'Fractionné') choices = [0, 1];
    else if (week.presetLevel >= top) choices = [top, top - 1];
    else choices = [week.presetLevel, week.presetLevel + 1];
    // Restarts each block, so a block always opens on its own level.
    const key = `${discipline}-${type}-${week.name}`;
    const occurrence = formatOccurrence[key] || 0;
    formatOccurrence[key] = occurrence + 1;
    return ranked[Math.min(choices[occurrence % choices.length], top)];
  }

  function longDistanceKm(discipline, week){
    const raceKm = currentGoals?.[`${discipline}_distance_km`] || RACE_SIZE_DISTANCES[raceSize][`${discipline}_distance_km`];
    const km = raceKm * LONG_SESSION_RATIO[raceSize][discipline] * week.load;
    return discipline === 'bike' ? Math.round(km) : Math.round(km * 2) / 2;
  }

  // Duration is intentionally left null for bike/run - estimating it means
  // guessing at paces we don't have. Distance, format text and segment
  // structure are real (from the rules/trees), so those are filled in.
  function fillCardio(row, discipline, week, role, type){
    row.title = type;
    row.duration_min = null;
    const paceSet = KEY_PACE_SETS[discipline][raceSize];
    if (type === 'Sortie longue') {
      const distanceKm = longDistanceKm(discipline, week);
      // In Spécifique the long session ends at race pace.
      const finish = week.phase === 3 ? `, dont les ${paceSet.longFinishKm} derniers km à allure cible` : '';
      row.tag = `≈${distanceKm} km`;
      row.segments = [{ label: 'Sortie longue', zone: ZONE_FOR_TYPE['Sortie longue'], text: `${distanceKm} km à allure ${discipline === 'run' ? 'confortable' : 'tranquille'}${finish}.` }];
      return;
    }
    const { warmup, cooldown } = CARDIO_WARMUP_COOLDOWN[discipline];
    let mainSet;
    if (type === 'Allure cible') {
      if (week.raceWeek) mainSet = paceSet.raceWeek;
      else {
        const reps = week.phase === 4 ? paceSet.taperReps : paceSet.reps[Math.min(week.weekInBlock, paceSet.reps.length) - 1];
        mainSet = `${reps}×${paceSet.rep}`;
      }
      row.tag = mainSet;
      mainSet = `${mainSet} allure cible (r = ${paceSet.rest})`;
    } else {
      mainSet = pickFormat(discipline, type, week).text;
      row.tag = mainSet;
    }
    const recoveryNote = type === 'Tempo' ? ' Récupération courte entre les blocs en Z1.' : ' Récupération entre les répétitions en Z1.';
    row.segments = [
      { label: 'Échauffement', zone: 'Z1', text: `${warmup} min à allure facile.` },
      { label: 'Corps de séance', zone: ZONE_FOR_TYPE[type], text: `${mainSet}.${recoveryNote}` },
      { label: 'Retour au calme', zone: 'Z1', text: `${cooldown} min à allure facile.` },
    ];
  }

  function fillSwim(row, week, role, objective){
    const light = week.phase === 4 || week.recovery;
    const drillReps = objective === SWIM_OBJECTIVE.seuil ? 6 : 8;
    const outerM = SWIM_WARMUP_M + drillReps * 50 + SWIM_COOLDOWN_M;
    let main;
    if (objective === SWIM_OBJECTIVE.endurance) {
      const target = SWIM_PEAK_DISTANCE_M[raceSize] * week.load;
      main = swimEnduranceSet(target - outerM, light);
    } else {
      const preset = pickFormat('swim', objective, week);
      main = { meters: preset.m, lines: [`${preset.text.replace('x', '×').replace(/m$/, ' m')} ${preset.detail}`] };
    }

    row.title = objective;
    row.tag = `${outerM + main.meters} m`;
    row.duration_min = null;
    row.segments = [
      { label: 'Échauffement', text: '100 Z1 nages au choix<br>100 Z2 nages au choix' },
      { label: 'Éducatifs', text: `${drillReps}×50 (25 m éducatif - 25 m Z1), r = 15″ : ${SWIM_DRILL_CHOICE}` },
      { label: 'Corps de séance', text: main.lines.join('<br>') },
      { label: 'Retour au calme', text: '50 à 200 Z1 libre, nages au choix, dont au moins les 25 derniers mètres en dos 2 bras.' },
    ];
  }

  let sessionCounter = 0;
  const rows = [];
  const keySessionCount = {}; // discipline -> non-recovery key sessions so far, from Base 2 on
  const specificKeyCount = {}; // discipline -> key sessions so far in Spécifique

  for (let weekNumber = 1; weekNumber <= weeksTotal; weekNumber++) {
    const days = weekDays.get(weekNumber) || [];
    if (days.length === 0) continue;
    const week = season[weekNumber - 1];

    const counts = sessionCounts(days.length);
    const sessions = disciplines.flatMap((discipline, i) =>
      rolesFor(discipline, counts[i], weekNumber, week)
        .filter(role => typeFor(discipline, week, role) !== null)
        .map(role => ({ discipline, role })));

    const placed = placeWeek(sessions, days);

    // A contrainte blocking a session's sport hands its day to an allowed
    // sport - the user's own first (highest priority first), else any allowed
    // cardio sport. Nothing allowed: the day stays free. The replacement keeps
    // the role unless that sport already has it this week (one long and one
    // key session per sport), in which case it takes the next role down.
    const rolesUsed = new Map(); // discipline -> Set of roles this week
    const markRole = (discipline, role) => {
      if (!rolesUsed.has(discipline)) rolesUsed.set(discipline, new Set());
      rolesUsed.get(discipline).add(role);
    };
    const isBlocked = s => {
      const constraint = constraintForDate(s.day.dateStr);
      return constraint && !constraint.allowed_disciplines.includes(s.discipline);
    };
    placed.filter(s => !isBlocked(s)).forEach(s => markRole(s.discipline, s.role));
    for (const session of [...placed].sort((a, b) => a.day.dayIndex - b.day.dayIndex)) {
      if (!isBlocked(session)) continue;
      const allowed = constraintForDate(session.day.dateStr).allowed_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
      session.discipline = disciplines.find(d => allowed.includes(d)) || allowed[0] || null;
      if (!session.discipline) continue;
      const used = rolesUsed.get(session.discipline) || new Set();
      const fromIndex = ROLE_PLACEMENT_ORDER.indexOf(session.role);
      session.role = ROLE_PLACEMENT_ORDER.slice(fromIndex).find(r => r === 'complément' || !used.has(r));
      markRole(session.discipline, session.role);
    }

    placed
      .filter(s => s.discipline)
      .sort((a, b) => a.day.dayIndex - b.day.dayIndex)
      .forEach((session, orderIndex) => {
        let type = typeFor(session.discipline, week, session.role);
        if (!type) return;
        const partner = KEY_PARTNER_BY_BLOCK[week.name];
        if (partner && session.role === 'clé' && session.discipline !== 'swim') {
          if (week.recovery) {
            type = 'Tempo';
          } else {
            const count = keySessionCount[session.discipline] || 0;
            keySessionCount[session.discipline] = count + 1;
            type = count % 2 === 0 ? 'Fractionné' : partner;
          }
        }
        if (week.name === 'Spécifique' && session.role === 'clé' && session.discipline !== 'swim') {
          const count = specificKeyCount[session.discipline] || 0;
          specificKeyCount[session.discipline] = count + 1;
          type = SPECIFIC_KEY_ALTERNATION[count % SPECIFIC_KEY_ALTERNATION.length];
        }
        if (session.discipline === 'swim' && session.role === 'clé' && (week.phase === 2 || week.phase === 3)) {
          if (week.recovery) {
            type = SWIM_OBJECTIVE.technique;
          } else {
            const count = keySessionCount.swim || 0;
            keySessionCount.swim = count + 1;
            type = SWIM_KEY_ALTERNATION[count % SWIM_KEY_ALTERNATION.length];
          }
        }
        sessionCounter++;
        const row = {
          session_key: `gen-${sessionCounter}`,
          week_number: weekNumber,
          phase: week.phase,
          order_index: orderIndex,
          discipline: session.discipline,
          icon: DISCIPLINE_EMOJI[session.discipline],
          title: DISCIPLINE_LABELS[session.discipline],
          tag: null,
          duration_min: null,
          segments: [],
          session_date: session.day.dateStr,
        };
        if (session.discipline === 'swim') fillSwim(row, week, session.role, type);
        else fillCardio(row, session.discipline, week, session.role, type);
        rows.push(row);
      });
  }

  // Renfo: fixed frequency per week, placed on that week's first N training
  // days (chronologically) rather than competing in the weekly split.
  // Contraintes only restrict cardio disciplines (their picker doesn't offer
  // Renfo), except a full-rest one, which skips its days.
  const strengthPerWeek = Math.min(currentPreferences.strength_sessions_per_week || 0, trainingDays.length);
  if (strengthPerWeek > 0) {
    for (const [weekNumber, days] of weekDays) {
      // Full-rest contraintes (no discipline allowed) drop the renfo too.
      const strengthDays = days.filter(day => constraintForDate(day.dateStr)?.allowed_disciplines.length !== 0);
      strengthDays.slice(0, strengthPerWeek).forEach((day, i) => {
        sessionCounter++;
        rows.push({
          session_key: `gen-${sessionCounter}`,
          week_number: weekNumber,
          phase: season[weekNumber - 1].phase,
          order_index: 1000 + i, // after that week's cardio sessions; exact value isn't meaningful, rendering sorts by date
          discipline: 'strength',
          icon: DISCIPLINE_EMOJI.strength,
          title: DISCIPLINE_LABELS.strength,
          tag: 'Renforcement',
          duration_min: STRENGTH_DURATION,
          segments: [],
          session_date: day.dateStr,
        });
      });
    }
  }

  return rows;
}

async function savePlanStartDate(dateStr){
  const updated = { ...currentPreferences, plan_start_date: dateStr, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('plan_preferences').upsert(updated);
  if (error) {
    console.error('Erreur de sauvegarde du début du plan', error);
    return false;
  }
  currentPreferences = updated;
  return true;
}

let toastTimer = null;
function showToast(message){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function generatePersonalizedPlan(){
  const { data: existing, error: fetchError } = await supabase
    .from('plan_sessions')
    .select('session_key');

  if (fetchError) {
    console.error('Erreur de vérification du plan existant', fetchError);
    return;
  }

  // Only ever skip when a real hand-written plan exists (any session_key not
  // prefixed "gen-") - never touch that. A previously *generated* plan is
  // safe to replace, so re-running onboarding actually regenerates instead
  // of silently keeping stale results from an earlier run.
  const hasRealPlan = existing.some(row => !row.session_key.startsWith('gen-'));
  if (hasRealPlan) return;

  // Save the default start ("demain") as a real date, so recalculating the
  // plan later keeps the same first day.
  if (!currentPreferences.plan_start_date && !(await savePlanStartDate(ymdFromDate(tomorrowDate())))) return;

  const rows = buildGeneratedPlan();
  if (rows.length === 0) return;

  if (existing.length > 0) {
    const { error: deleteError } = await supabase
      .from('plan_sessions')
      .delete()
      .in('session_key', existing.map(row => row.session_key));
    if (deleteError) {
      console.error('Erreur de suppression de l\'ancien plan généré', deleteError);
      return;
    }
  }

  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await supabase
    .from('plan_sessions')
    .insert(rows.map(row => ({ ...row, user_id: session?.user?.id })));

  if (error) {
    console.error('Erreur de génération du plan', error);
    return;
  }

  await loadAndRenderSessions();
}

// Recomputes an existing generated plan after a change made along the way
// (a contrainte, the race, the habits), when the athlete asks for it from
// the popup (see askReplan). The whole plan is rebuilt from its
// start so phases and progression stay right, but only what's ahead is
// replaced: sessions before today and sessions already done are kept as
// they are, since they're the athlete's history. Does nothing before
// onboarding has generated a plan, or next to a hand-written plan.
let replanQueue = Promise.resolve();
function replanFromToday(){
  replanQueue = replanQueue.then(doReplanFromToday, doReplanFromToday);
  return replanQueue;
}

// A change that affects the plan doesn't rebuild it on its own: a popup
// asks first. Saying no keeps the plan as it is (the change stays saved
// in the réglages and is taken into account at the next recalculation).
function hasGeneratedPlan(){
  const keys = [...sessionsByKey.keys()];
  return keys.length > 0 && keys.every(key => key.startsWith('gen-'));
}

function askReplan(){
  if (!hasGeneratedPlan()) return;
  document.getElementById('replan-popup').hidden = false;
}

document.getElementById('replan-no-btn').addEventListener('click', () => {
  document.getElementById('replan-popup').hidden = true;
});

document.getElementById('replan-yes-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Recalcul…';
  const done = await replanFromToday();
  btn.disabled = false;
  btn.textContent = 'Recalculer';
  document.getElementById('replan-popup').hidden = true;
  if (done) showToast('Plan mis à jour à partir d\'aujourd\'hui');
});

async function doReplanFromToday(){
  const { data: existing, error: fetchError } = await supabase
    .from('plan_sessions')
    .select('session_key, session_date, discipline, done');
  if (fetchError) {
    console.error('Erreur de vérification du plan existant', fetchError);
    return;
  }
  if (existing.length === 0 || existing.some(row => !row.session_key.startsWith('gen-'))) return;

  // A plan generated with the default start ("demain") never saved that
  // date, so rebuilding it would restart the plan from tomorrow instead of
  // its real first day. Pin it to the plan's first session.
  if (!currentPreferences.plan_start_date) {
    const firstDate = existing.map(row => row.session_date).filter(Boolean).sort()[0];
    if (firstDate && !(await savePlanStartDate(firstDate))) return;
  }

  const rows = buildGeneratedPlan();
  if (rows.length === 0) return;

  const today = ymdFromDate(new Date());
  const isKept = row => (row.session_date && row.session_date < today) || row.done;
  const kept = existing.filter(isKept);
  const replaced = existing.filter(row => !isKept(row));
  // A session already done today stays; don't add the new plan's session of
  // the same sport that day on top of it.
  const keptToday = new Set(kept.filter(row => row.session_date >= today).map(row => `${row.session_date}-${row.discipline}`));
  // Fresh keys, so a new session never takes the key of a kept one.
  const batch = Date.now().toString(36);
  const upcoming = rows
    .filter(row => row.session_date >= today && !keptToday.has(`${row.session_date}-${row.discipline}`))
    .map((row, i) => ({ ...row, session_key: `gen-${batch}-${i + 1}` }));

  if (replaced.length > 0) {
    const { error: deleteError } = await supabase
      .from('plan_sessions')
      .delete()
      .in('session_key', replaced.map(row => row.session_key));
    if (deleteError) {
      console.error('Erreur de suppression des séances à venir', deleteError);
      return;
    }
  }

  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await supabase
    .from('plan_sessions')
    .insert(upcoming.map(row => ({ ...row, user_id: session?.user?.id })));
  if (error) {
    console.error('Erreur de recalcul du plan', error);
    return;
  }

  await loadAndRenderSessions();
  return true;
}

// Only ever deletes *generated* sessions (session_key prefixed "gen-") -
// never a real hand-written plan, same safeguard as generatePersonalizedPlan.
async function resetGeneratedPlan(){
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  const { data: existing, error: fetchError } = await supabase
    .from('plan_sessions')
    .select('session_key');
  if (fetchError) {
    console.error('Erreur de vérification du plan existant', fetchError);
    return;
  }
  const generatedKeys = existing.filter(row => row.session_key.startsWith('gen-')).map(row => row.session_key);
  if (generatedKeys.length > 0) {
    const { error: deleteSessionsError } = await supabase
      .from('plan_sessions')
      .delete()
      .in('session_key', generatedKeys);
    if (deleteSessionsError) {
      console.error('Erreur de suppression des séances générées', deleteSessionsError);
      return;
    }
  }

  const { error: deleteConstraintsError } = await supabase
    .from('plan_constraints')
    .delete()
    .eq('user_id', userId);
  if (deleteConstraintsError) {
    console.error('Erreur de suppression des contraintes', deleteConstraintsError);
    return;
  }

  const resetPreferences = {
    user_id: userId,
    training_days: [],
    preferred_disciplines: [],
    discipline_priority: {},
    plan_start_date: null,
    strength_sessions_per_week: 0,
    updated_at: new Date().toISOString(),
  };
  const { error: resetPrefsError } = await supabase.from('plan_preferences').upsert(resetPreferences);
  if (resetPrefsError) {
    console.error('Erreur de réinitialisation des préférences', resetPrefsError);
    return;
  }

  currentPreferences = resetPreferences;
  currentConstraints = [];
  trainingPrefsOnboardingDone = false;
  trainingPrefsStep = 1;
  await loadAndRenderSessions();
  renderTrainingPrefsPanel();
}

function renderTrainingPrefsPanel(){
  // Goals and preferences load in parallel; the wizard's first step needs both.
  if (!currentPreferences || !currentGoals) return;
  const container = document.getElementById('training-prefs-container');

  if (trainingPrefsOnboardingDone === null) trainingPrefsOnboardingDone = isPrefsConfigured();

  async function finishOnboarding(button){
    button.disabled = true;
    button.textContent = 'Génération…';
    await generatePersonalizedPlan();
    trainingPrefsOnboardingDone = true;
    trainingPrefsStep = 1;
    renderTrainingPrefsPanel();
  }

  if (!trainingPrefsOnboardingDone) {
    if (trainingPrefsStep === 4) {
      container.innerHTML = trainingPrefsStep3Html();
      renderStravaSettingsContent('wizard-strava-status', false);
      document.getElementById('prefs-back-btn').addEventListener('click', () => {
        trainingPrefsStep = 3;
        renderTrainingPrefsPanel();
      });
      document.getElementById('prefs-finish-btn').addEventListener('click', () => {
        finishOnboarding(document.getElementById('prefs-finish-btn'));
      });
    } else if (trainingPrefsStep === 3) {
      container.innerHTML = trainingPrefsStep2Html(currentPreferences, currentConstraints);
      renderConstraintList();
      wireContraintesSection();
      document.getElementById('prefs-back-btn').addEventListener('click', () => {
        trainingPrefsStep = 2;
        renderTrainingPrefsPanel();
      });
      document.getElementById('prefs-step2-next-btn').addEventListener('click', async () => {
        const nextBtn = document.getElementById('prefs-step2-next-btn');
        const errorEl = document.getElementById('contraintes-step-error');
        if (ymdFromDate(planStartDate()) >= currentGoals.race_date) {
          errorEl.textContent = `Le plan doit commencer avant la course (${formatDateShort(currentGoals.race_date)}).`;
          errorEl.hidden = false;
          return;
        }
        errorEl.hidden = true;
        if (await isStravaVisible()) {
          trainingPrefsStep = 4;
          renderTrainingPrefsPanel();
        } else {
          await finishOnboarding(nextBtn);
        }
      });
    } else if (trainingPrefsStep === 2) {
      container.innerHTML = trainingPrefsStep1Html(currentPreferences);
      document.getElementById('prefs-back-btn').addEventListener('click', () => {
        trainingPrefsStep = 1;
        renderTrainingPrefsPanel();
      });
      const selectedDays = new Set(currentPreferences.training_days);
      const preferredOrder = currentPreferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
      const priorityMap = Object.fromEntries(preferredOrder.map(d => [d, currentPreferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL]));
      const strengthState = { value: currentPreferences.strength_sessions_per_week || 0 };
      toggleChipGroup('.day-check-btn', selectedDays, 'day');
      wirePreferredDisciplines(preferredOrder, priorityMap);
      wireStrengthFrequency(strengthState);

      document.getElementById('prefs-next-btn').addEventListener('click', async () => {
        if (selectedDays.size === 0 || preferredOrder.length === 0) return;
        const updated = {
          ...currentPreferences,
          training_days: DAY_OPTIONS.filter(d => selectedDays.has(d)),
          preferred_disciplines: [...preferredOrder],
          discipline_priority: { ...priorityMap },
          strength_sessions_per_week: strengthState.value,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('plan_preferences').upsert(updated);
        if (error) {
          console.error('Erreur de sauvegarde des préférences', error);
          return;
        }
        currentPreferences = updated;
        trainingPrefsStep = 3;
        renderTrainingPrefsPanel();
      });
    } else {
      container.innerHTML = trainingPrefsRaceStepHtml(currentGoals);
      const getSize = wireRaceSizeButtons(currentGoals.size);
      document.getElementById('prefs-race-next-btn').addEventListener('click', async () => {
        const raceDate = document.getElementById('race-info-date').value;
        const errorEl = document.getElementById('race-step-error');
        const problem = raceDateProblem(raceDate);
        if (problem) {
          errorEl.textContent = problem;
          errorEl.hidden = false;
          return;
        }
        errorEl.hidden = true;
        const saved = await saveRaceInfo({
          name: document.getElementById('race-info-name').value.trim() || null,
          raceDate,
          size: getSize(),
        });
        if (!saved) return;
        trainingPrefsStep = 2;
        renderTrainingPrefsPanel();
      });
    }
    return;
  }

  container.innerHTML = trainingPrefsFullFormHtml(currentPreferences, currentConstraints);
  renderConstraintList();
  wireContraintesSection();

  document.getElementById('reset-plan-btn').addEventListener('click', async (e) => {
    if (!confirm('Réinitialiser le plan ? Cela supprime les séances générées, tes habitudes et tes contraintes.')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Réinitialisation…';
    await resetGeneratedPlan();
  });
  attachDayCardHandlers();

  renderHabitsView();
}

function renderHabitsView(){
  const view = document.getElementById('habits-view');
  if (!view) return;
  view.innerHTML = habitsSummaryHtml(currentPreferences);
  document.getElementById('habits-edit-btn').addEventListener('click', renderHabitsEditor);
}

function renderHabitsEditor(){
  const view = document.getElementById('habits-view');
  view.innerHTML = `${prefsFieldsHtml(currentPreferences)}
    <p class="wizard-error" id="habits-error" hidden></p>
    <div class="constraint-add-actions">
      <button type="button" class="goal-save-btn btn-compact" id="habits-save-btn">Enregistrer</button>
      <button type="button" class="constraint-cancel-btn" id="habits-cancel-btn">Annuler</button>
    </div>`;

  // Edited locally, saved only on "Enregistrer".
  const selectedDays = new Set(currentPreferences.training_days);
  const preferredOrder = currentPreferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
  const priorityMap = Object.fromEntries(preferredOrder.map(d => [d, currentPreferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL]));
  const strengthState = { value: currentPreferences.strength_sessions_per_week || 0 };

  toggleChipGroup('.day-check-btn', selectedDays, 'day');
  wirePreferredDisciplines(preferredOrder, priorityMap);
  wireStrengthFrequency(strengthState);

  document.getElementById('habits-cancel-btn').addEventListener('click', renderHabitsView);
  document.getElementById('habits-save-btn').addEventListener('click', async (e) => {
    const errorEl = document.getElementById('habits-error');
    if (selectedDays.size === 0 || preferredOrder.length === 0) {
      errorEl.textContent = 'Choisis au moins un jour et un sport.';
      errorEl.hidden = false;
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    const updated = {
      ...currentPreferences,
      training_days: DAY_OPTIONS.filter(d => selectedDays.has(d)),
      preferred_disciplines: [...preferredOrder],
      discipline_priority: { ...priorityMap },
      strength_sessions_per_week: strengthState.value,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('plan_preferences').upsert(updated);
    if (error) {
      console.error('Erreur de sauvegarde des préférences', error);
      errorEl.textContent = 'L\'enregistrement a échoué, réessaie.';
      errorEl.hidden = false;
      btn.disabled = false;
      return;
    }
    currentPreferences = updated;
    renderHabitsView();
    askReplan();
  });
}

let onboardingPrimaryHandler = null;
let onboardingDismissHandler = null;

function showOnboardingPopup({ title, text, primaryLabel, onPrimary, onDismiss }){
  // These popups are about the home page (race info / splits) - only show
  // them there. Saving Mon triathlon from Réglages, for instance, should
  // not pop something up on top of Réglages.
  if (!document.getElementById('m1').checked) return;

  const popup = document.getElementById('onboarding-popup');
  document.getElementById('onboarding-title').textContent = title;
  document.getElementById('onboarding-text').textContent = text;

  const primaryBtn = document.getElementById('onboarding-primary-btn');
  primaryBtn.textContent = primaryLabel;
  const dismissBtn = document.getElementById('onboarding-dismiss-btn');
  dismissBtn.hidden = !onDismiss;

  // Swap the handlers directly instead of cloning/replacing the buttons -
  // simpler to reason about, especially since this popup can re-open
  // itself from inside its own dismiss handler (the "show the next popup"
  // chaining below).
  if (onboardingPrimaryHandler) primaryBtn.removeEventListener('click', onboardingPrimaryHandler);
  if (onboardingDismissHandler) dismissBtn.removeEventListener('click', onboardingDismissHandler);

  onboardingPrimaryHandler = () => {
    popup.hidden = true;
    onPrimary();
  };
  onboardingDismissHandler = () => {
    popup.hidden = true;
    if (onDismiss) onDismiss();
  };

  primaryBtn.addEventListener('click', onboardingPrimaryHandler);
  dismissBtn.addEventListener('click', onboardingDismissHandler);

  popup.hidden = false;
}

function showGoalsReminderPopup(){
  showOnboardingPopup({
    title: 'Définis tes objectifs de temps',
    text: 'Sur la page d\'accueil, tape sur chaque étape (nage, T1, vélo, T2, course) pour indiquer le temps ou l\'allure que tu vises.',
    primaryLabel: 'Compris',
    onPrimary: () => {},
  });
}

function maybeShowOnboardingPopup(goals){
  const durations = [goals.swim_duration_sec, goals.t1_duration_sec, goals.bike_duration_sec, goals.t2_duration_sec, goals.run_duration_sec];
  const goalsMissing = durations.some(v => v == null);

  if (!goals.race_date || goals.swim_distance_m == null) {
    showOnboardingPopup({
      title: 'Configure ta course',
      text: 'Renseigne le nom, la date et le format de ton triathlon pour personnaliser ton plan et tes objectifs.',
      primaryLabel: 'Configurer maintenant',
      onPrimary: openRaceInfoEditor,
      // Dismissing without configuring still shows the goals reminder
      // right after, if goals are not set either.
      onDismiss: goalsMissing ? showGoalsReminderPopup : undefined,
    });
    return;
  }

  if (goalsMissing) showGoalsReminderPopup();
}

const RACE_SIZE_LABELS = { S: 'Sprint', M: 'M' };

const RACE_SIZE_DISTANCES = {
  S: { swim_distance_m: 750, bike_distance_km: 20, run_distance_km: 5 },
  M: { swim_distance_m: 1500, bike_distance_km: 40, run_distance_km: 10 },
};

function raceInfoFieldsHtml(goals, minDate = null){
  return `<div class="goal-field">
      <label>Nom</label>
      <input type="text" id="race-info-name" value="${escapeHtml(goals.name || '')}">
    </div>
    <div class="goal-field">
      <label>Date</label>
      <input type="date" id="race-info-date" value="${goals.race_date || ''}"${minDate ? ` min="${minDate}"` : ''}>
    </div>
    <div class="goal-field">
      <label>Format</label>
      <div class="race-size-options">${['S', 'M']
        .map(sz => `<button type="button" class="race-size-btn${goals.size === sz ? ' active' : ''}" data-size="${sz}">${RACE_SIZE_LABELS[sz]}</button>`)
        .join('')}</div>
    </div>`;
}

function raceInfoEditorHtml(goals){
  return `<div class="detail-title" style="margin-bottom:16px;">Mon triathlon</div>
    ${raceInfoFieldsHtml(goals, ymdFromDate(tomorrowDate()))}
    <p class="wizard-error" id="race-info-error" hidden></p>
    <button type="button" class="goal-save-btn" id="save-race-info-btn">Enregistrer</button>`;
}

// Why a race date can't be used, or null if it can: it must be in the
// future, and after the plan's start date when one is set.
function raceDateProblem(raceDate){
  if (!raceDate || raceDate <= ymdFromDate(new Date())) return 'Choisis une date de course à venir.';
  const planStart = currentPreferences?.plan_start_date;
  if (planStart && raceDate <= planStart) return `La course doit être après le début du plan (${formatDateShort(planStart)}).`;
  return null;
}

// Returns a getter for the currently selected size.
function wireRaceSizeButtons(initialSize){
  let selectedSize = initialSize;
  document.querySelectorAll('.race-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSize = btn.dataset.size;
      document.querySelectorAll('.race-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  return () => selectedSize;
}

async function saveRaceInfo({ name, raceDate, size }){
  const sizeChanged = size !== currentGoals.size;
  const notYetConfigured = currentGoals.swim_distance_m == null;
  const distances = (sizeChanged || notYetConfigured) ? RACE_SIZE_DISTANCES[size] : {};

  const updated = { ...currentGoals, name, race_date: raceDate, size, ...distances, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('plan_race_goals').upsert(updated);
  if (error) {
    console.error('Erreur de sauvegarde des infos de course', error);
    return false;
  }
  currentGoals = updated;
  renderRaceInfo(currentGoals);
  renderGoals(currentGoals);
  updateSplitLabels(currentGoals);
  return true;
}

function openRaceInfoEditor(){
  if (!currentGoals) return;

  document.getElementById('detail-content').innerHTML = raceInfoEditorHtml(currentGoals);
  const getSize = wireRaceSizeButtons(currentGoals.size);

  document.getElementById('save-race-info-btn').addEventListener('click', async () => {
    const raceDate = document.getElementById('race-info-date').value || currentGoals.race_date;
    const errorEl = document.getElementById('race-info-error');
    const problem = raceDateProblem(raceDate);
    if (problem) {
      errorEl.textContent = problem;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    const previous = { raceDate: currentGoals.race_date, size: currentGoals.size };
    const saved = await saveRaceInfo({
      name: document.getElementById('race-info-name').value.trim() || null,
      raceDate,
      size: getSize(),
    });
    if (!saved) return;
    closeDetail();
    if (previous.raceDate !== currentGoals.race_date || previous.size !== currentGoals.size) askReplan();
    maybeShowOnboardingPopup(currentGoals);
  });

  openDetailOverlay();
}

document.getElementById('race-info-settings-row').addEventListener('click', openRaceInfoEditor);

const GOAL_SEGMENTS = {
  swim: { title: 'Natation', durationField: 'swim_duration_sec', durationFormat: 'mmss', pace: {
    label: "Allure (m'ss/100m)",
    format: (goals) => formatPacePer100(goals.swim_duration_sec, goals.swim_distance_m),
    parse: (str, goals) => parsePacePer100(str, goals.swim_distance_m),
  }},
  t1: { title: 'T1', durationField: 't1_duration_sec', durationFormat: 'mmss' },
  bike: { title: 'Vélo', durationField: 'bike_duration_sec', durationFormat: 'hmm', pace: {
    label: 'Vitesse (km/h)',
    format: (goals) => formatSpeedKmh(goals.bike_duration_sec, goals.bike_distance_km),
    parse: (str, goals) => parseSpeedKmh(str, goals.bike_distance_km),
    inputMode: 'decimal',
  }},
  t2: { title: 'T2', durationField: 't2_duration_sec', durationFormat: 'mmss' },
  run: { title: 'Course', durationField: 'run_duration_sec', durationFormat: 'mmss', pace: {
    label: "Allure (m'ss/km)",
    format: (goals) => formatPacePerKm(goals.run_duration_sec, goals.run_distance_km),
    parse: (str, goals) => parsePacePerKm(str, goals.run_distance_km),
  }},
};

function goalSegmentEditorHtml(segment, goals){
  const durationLabel = segment.durationFormat === 'hmm' ? 'Durée (h:mm)' : 'Durée (mm:ss)';
  const rawDuration = goals[segment.durationField];
  const durationValue = rawDuration == null ? '' : (segment.durationFormat === 'hmm' ? formatHMM(rawDuration) : formatMMSS(rawDuration));

  const paceValue = rawDuration == null ? '' : segment.pace?.format(goals) ?? '';
  const paceHtml = segment.pace
    ? `<label>${segment.pace.label}</label><input type="text" inputmode="${segment.pace.inputMode || 'numeric'}" id="edit-goal-pace" value="${paceValue}">`
    : '';

  return `<div class="detail-title" style="margin-bottom:16px;">${segment.title}</div>
    <div class="goal-field">
      <label>${durationLabel}</label>
      <input type="text" inputmode="numeric" id="edit-goal-duration" value="${durationValue}">
      ${paceHtml}
    </div>
    <button type="button" class="goal-save-btn" id="save-goals-btn">Enregistrer</button>`;
}

function openGoalsEditor(goalKey){
  if (!currentGoals) return;
  const segment = GOAL_SEGMENTS[goalKey];
  if (!segment) return;

  document.getElementById('goal-sheet-content').innerHTML = goalSegmentEditorHtml(segment, currentGoals);

  const durationInput = document.getElementById('edit-goal-duration');
  const parseDuration = segment.durationFormat === 'hmm' ? parseHMM : parseMMSS;
  const formatDuration = segment.durationFormat === 'hmm' ? formatHMM : formatMMSS;

  maskDigitInput(durationInput, ':');

  const paceInput = document.getElementById('edit-goal-pace');
  if (paceInput) {
    if (segment.pace.inputMode !== 'decimal') maskDigitInput(paceInput, "'");

    durationInput.addEventListener('input', () => {
      const sec = parseDuration(durationInput.value);
      paceInput.value = segment.pace.format({ ...currentGoals, [segment.durationField]: sec });
    });
    paceInput.addEventListener('input', () => {
      const sec = segment.pace.parse(paceInput.value, currentGoals);
      if (sec) durationInput.value = formatDuration(sec);
    });
  }

  document.getElementById('save-goals-btn').addEventListener('click', async () => {
    const sec = parseDuration(durationInput.value);
    const updated = { ...currentGoals, [segment.durationField]: sec, updated_at: new Date().toISOString() };

    const { error } = await supabase.from('plan_race_goals').upsert(updated);
    if (error) {
      console.error('Erreur de sauvegarde des objectifs', error);
      return;
    }

    currentGoals = updated;
    renderGoals(currentGoals);
    closeGoalSheet();
  });

  openGoalSheet();
}

document.querySelectorAll('.split.editable').forEach(el => {
  el.addEventListener('click', () => openGoalsEditor(el.dataset.goal));
});

function exerciseItemHtml(ex){
  const tagsHtml = (ex.tags || []).map(tag => `<span class="exo-tag">${escapeHtml(tag)}</span>`).join('');
  return `<div class="exo-item"><b>${escapeHtml(ex.name)}</b>${tagsHtml} - ${escapeHtml(ex.description)}</div>`;
}

let exercisesByCategory = new Map();
let currentExerciseCategory = 'swim_drill';
let selectedExerciseTags = new Set();

function renderExerciseList(){
  const container = document.querySelector('[data-exercise-category]');
  if (!container) return;
  container.dataset.exerciseCategory = currentExerciseCategory;

  const exercises = exercisesByCategory.get(currentExerciseCategory) || [];
  const filtered = selectedExerciseTags.size === 0
    ? exercises
    : exercises.filter(ex => (ex.tags || []).some(tag => selectedExerciseTags.has(tag)));

  container.innerHTML = filtered.map(exerciseItemHtml).join('');
}

function availableExerciseTags(){
  const exercises = exercisesByCategory.get(currentExerciseCategory) || [];
  return Array.from(new Set(exercises.flatMap(ex => ex.tags || []))).sort();
}

function updateExerciseFilterButton(){
  const btn = document.getElementById('exo-filter-icon-btn');
  const countEl = document.getElementById('exo-filter-count');
  if (!btn || !countEl) return;

  const tags = availableExerciseTags();
  btn.hidden = tags.length === 0;
  btn.classList.toggle('has-active', selectedExerciseTags.size > 0);
  countEl.textContent = selectedExerciseTags.size > 0 ? String(selectedExerciseTags.size) : '';
}

function openExerciseTagFilter(){
  const tags = availableExerciseTags();
  if (tags.length === 0) return;

  document.getElementById('detail-content').innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Filtrer par muscle</div>
    <div class="exo-tag-filter">${tags
      .map(tag => `<button type="button" class="exo-tag-filter-btn${selectedExerciseTags.has(tag) ? ' active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`)
      .join('')}</div>`;

  document.querySelectorAll('#detail-content .exo-tag-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (selectedExerciseTags.has(tag)) {
        selectedExerciseTags.delete(tag);
      } else {
        selectedExerciseTags.add(tag);
      }
      btn.classList.toggle('active');
      updateExerciseFilterButton();
      renderExerciseList();
    });
  });

  openDetailOverlay();
}

document.getElementById('exo-filter-icon-btn').addEventListener('click', openExerciseTagFilter);

function renderExerciseCategory(category){
  currentExerciseCategory = category;
  selectedExerciseTags = new Set();
  updateExerciseFilterButton();
  renderExerciseList();
}

async function loadAndRenderExercises(){
  const { data, error } = await supabase
    .from('plan_exercises')
    .select('*')
    .order('order_index', { ascending: true });

  if (error) console.error('Erreur de chargement des exercices', error);
  const rows = error ? [] : data;

  exercisesByCategory = new Map();
  for (const ex of rows) {
    if (!exercisesByCategory.has(ex.category)) exercisesByCategory.set(ex.category, []);
    exercisesByCategory.get(ex.category).push(ex);
  }

  renderExerciseCategory('swim_drill');
}

document.querySelectorAll('.exo-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.exo-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderExerciseCategory(btn.dataset.exerciseFilter);
  });
});

function updateCountdown(){
  if (!raceTargetDate) return;
  const now = new Date();
  let diff = Math.max(0, raceTargetDate - now);

  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
  const mins = Math.floor(diff / 60000); diff -= mins * 60000;
  const secs = Math.floor(diff / 1000);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val).padStart(2, '0'); };
  set('cd-days', days);
  set('cd-hours', hours);
  set('cd-mins', mins);
  set('cd-secs', secs);
}
updateCountdown();
setInterval(updateCountdown, 1000);
