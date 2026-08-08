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
  const segsHtml = (s.segments || [])
    .map(seg => `<span class="seg"><b class="seg-label">${escapeHtml(seg.label)}</b> ${seg.text}</span>`)
    .join('');
  const stravaHtml = s.session_date
    ? `<p class="detail-card-title">Résultat de la séance</p><div class="detail-card detail-strava"><div id="detail-strava"><p class="detail-strava-status">Chargement Strava…</p></div></div>`
    : '';
  // Test: only s2-3 has a hand-built .fit file for now, to validate the
  // Garmin import flow before generating one per session.
  const fitHtml = s.session_key === 's2-3'
    ? `<a class="detail-fit-link" href="/fit/s2-3-sortie-longue.fit" download aria-label="Télécharger la séance (test Garmin)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><polyline points="12 9 12 12 13.5 13.5"/><path d="M16.51 17.35l-.35 3.83a2 2 0 0 1-2 1.82H9.83a2 2 0 0 1-2-1.82l-.35-3.83m.01-10.7.35-3.83A2 2 0 0 1 9.83 1h4.35a2 2 0 0 1 2 1.82l.35 3.83"/></svg></a>`
    : '';

  return `<div class="detail-head"><span class="detail-icon">${s.icon}</span><div class="detail-title-row"><span class="detail-title">${escapeHtml(s.title)}</span>${tagHtml}${durationHtml}</div></div><div class="detail-meta-row"><label class="detail-date-field">Date<input type="date" id="detail-date-input" data-key="${s.session_key}" value="${s.session_date || ''}"></label><label class="detail-done-toggle">Fait<span class="detail-done-box-wrap"><input type="checkbox" id="detail-done-checkbox" data-key="${s.session_key}"${s.done ? ' checked' : ''}><span class="detail-done-box"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 12 9 17 20 6"/></svg></span></span></label>${fitHtml}</div><p class="detail-card-title">Détail de la séance</p><div class="detail-card"><p class="detail-segments">${segsHtml}</p></div>${stravaHtml}`;
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
    el.innerHTML = `<p class="detail-strava-status">Séance à venir — pas encore réalisée.</p>`;
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
  // plan's calendar — a generated plan's own week N would otherwise show
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
  // bailing out — otherwise whichever account's sessions were on screen
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

function refreshProgress(){
  const now = new Date();

  const weeks = new Map();
  for (const s of sessionsByKey.values()) {
    if (!weeks.has(s.week_number)) weeks.set(s.week_number, []);
    weeks.get(s.week_number).push(s);
  }

  const totalSessions = sessionsByKey.size;

  const expectedSessions = Array.from(weeks.entries()).reduce(
    (sum, [weekNumber, sessions]) => sum + sessions.length * weekCreditFraction(weekNumber, now),
    0
  );
  const expectedPct = totalSessions ? (expectedSessions / totalSessions * 100) : 0;

  const done = Array.from(sessionsByKey.values()).filter(s => s.done).length;
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
  // real data is loaded and rendered — otherwise whatever was already in
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
    // else) — not on every token refresh for the same user. The gate
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
// digit-only input (e.g. "530") must still parse — treat the last two
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
  const durationOrDash = (sec, formatter) => (sec == null ? '–' : '~' + formatter(sec));
  const paceOrDash = (sec, dist, formatter, unit) => (sec == null || dist == null ? '–' : formatter(sec, dist) + unit);

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
    document.getElementById('split-total').textContent = '–';
    return;
  }
  const totalMin = Math.round(durations.reduce((a, b) => a + b, 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  document.getElementById('split-total').textContent = `≈ ${h}h${String(m).padStart(2, '0')}`;
}

function updateSplitLabels(goals){
  document.getElementById('split-swim-label').textContent = goals.swim_distance_m == null ? '–' : `${goals.swim_distance_m} m`;
  document.getElementById('split-bike-label').textContent = goals.bike_distance_km == null ? '–' : `${goals.bike_distance_km} km`;
  document.getElementById('split-run-label').textContent = goals.run_distance_km == null ? '–' : `${goals.run_distance_km} km`;
}

function setHomeRaceConfigurable(configurable){
  document.querySelector('.home-header').classList.toggle('configurable', configurable);
  document.getElementById('countdown-block').classList.toggle('configurable', configurable);
}

function renderRaceInfo(goals){
  if (!goals.race_date) {
    document.getElementById('home-race-name').innerHTML = `<em>Mon</em> triathlon`;
    document.getElementById('home-race-day').textContent = '–';
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
  document.title = `Plan Triathlon ${goals.size} — ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
  raceTargetDate = new Date(goals.race_date + 'T10:00:00');
  // Refresh the displayed digits immediately — otherwise they keep
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
    // No row for this account (e.g. it was never created, or got deleted) —
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
// contrainte discipline pickers — it doesn't compete for rotation weight
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

function calendarPanelHtml(viewYear, viewMonth, startDate, endDate){
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push('<span class="calendar-day empty"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ymd(viewYear, viewMonth, day);
    const isStart = dateStr === startDate;
    const isEnd = dateStr === endDate;
    const inRange = startDate && endDate && dateStr > startDate && dateStr < endDate;
    const classes = ['calendar-day'];
    if (isStart || isEnd) classes.push('selected');
    if (inRange) classes.push('in-range');
    cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${dateStr}">${day}</button>`);
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
  const disciplines = constraint.allowed_disciplines.map(d => `${DISCIPLINE_EMOJI[d] || ''} ${DISCIPLINE_LABELS[d] || d}`).join('  ');
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

const WIZARD_STEP_LABELS = ['Habitudes', 'Contraintes', 'Strava'];

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

// Three priority tiers rather than a strict ranking — several sports can
// share the same tier (equal priority), unlike an ordered list where every
// position is necessarily distinct.
const PRIORITY_LEVELS = [{ value: 1, label: 'Basse' }, { value: 2, label: 'Moyenne' }, { value: 3, label: 'Haute' }];
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

function contraintesSectionHtml(preferences, constraints, centerToggle = false){
  const startLabel = preferences.plan_start_date ? formatDateShort(preferences.plan_start_date) : 'Demain (par défaut)';
  return `<div class="goal-field">
      <label>Début du plan</label>
      <button type="button" class="calendar-trigger-btn" id="plan-start-date-btn">📅 ${startLabel}</button>
      <div class="calendar-panel" id="plan-start-calendar-panel" hidden></div>
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
      </div>
      <div class="constraint-add-actions">
        <button type="button" class="goal-save-btn btn-compact" id="add-constraint-btn">Ajouter</button>
        <button type="button" class="constraint-cancel-btn" id="cancel-constraint-btn">Annuler</button>
      </div>
    </div>`;
}

function trainingPrefsStep1Html(preferences){
  return `<div class="wizard-card">
    <div class="wizard-hero">🎯</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Configurons ton plan</div>
    <p class="settings-sub" style="text-align:center;">Dis-nous quand et quoi tu aimes t'entraîner.</p>
    ${wizardStepsHtml(1)}
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
    ${wizardStepsHtml(2)}
    ${contraintesSectionHtml(preferences, constraints, true)}
    <button type="button" class="goal-save-btn wizard-next-btn" id="prefs-step2-next-btn" style="margin-top:24px;">Suivant →</button>
  </div>`;
}

function trainingPrefsStep3Html(){
  return `<div class="wizard-card">
    <button type="button" class="wizard-back-link" id="prefs-back-btn">← Précédent</button>
    <div class="wizard-hero">🔗</div>
    <div class="detail-title" style="margin-bottom:4px;text-align:center;">Connecte Strava</div>
    <p class="settings-sub" style="text-align:center;">Pour comparer tes séances planifiées à tes vraies activités (facultatif).</p>
    ${wizardStepsHtml(3)}
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
  // currentWeekNumber(), which is tied to WEEK_DATE_RANGES — the real
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
    return `<div class="plan-phase-head" style="--phase-color:${color}">
        <span class="plan-phase-icon">${PHASE_ICONS[phase] || ''}</span>
        <div>
          <h3>Phase ${phase} — ${PHASE_NAMES[phase] || ''}</h3>
          <p class="plan-phase-goal">${PHASE_GOALS[phase] || ''}</p>
        </div>
      </div>
      ${weeksHtml}`;
  }).join('');

  return `<div class="detail-title" style="margin:24px 0 12px;">Ton plan</div>${body}`;
}

function trainingPrefsFullFormHtml(preferences, constraints){
  return prefsCardHtml('🎯', 'Habitudes', "Jours d'entraînement et sports pratiqués.",
    prefsFieldsHtml(preferences))
    + prefsCardHtml('🗓️', 'Contraintes', 'Vacances, blessures, périodes particulières.',
    contraintesSectionHtml(preferences, constraints))
    + betaPlanSectionHtml();
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
      ? `<p class="priority-hint">Priorité (plusieurs sports peuvent partager le même niveau)</p>${priorityListHtml(order, priorityMap)}`
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

// A single 0-5 slider for Renfo frequency — a separate question from the
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

  function render(){
    panel.innerHTML = calendarPanelHtml(viewYear, viewMonth, selectedDate, null);

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
    panel.querySelectorAll('.calendar-day:not(.empty)').forEach(cell => {
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
    if (!constraintStart || !constraintEnd || selectedConstraintDisciplines.size === 0) return;

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
  });
}

function buildGeneratedPlan(){
  const trainingDays = DAY_OPTIONS.filter(d => currentPreferences.training_days.includes(d));
  // Order matters here: preferred_disciplines is saved in priority order
  // (highest priority first), used below to weight who gets more sessions.
  // Renfo never participates in this rotation — it's scheduled separately
  // below, by fixed weekly frequency rather than competing for priority.
  const disciplines = currentPreferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
  if (trainingDays.length === 0 || disciplines.length === 0) return [];

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const planStart = currentPreferences.plan_start_date
    ? new Date(currentPreferences.plan_start_date + 'T00:00:00')
    : tomorrow;

  // Weeks are always real Monday-Sunday calendar weeks, not rolling periods
  // from planStart — otherwise a single displayed week could span the tail
  // of one calendar week and the start of the next (e.g. Sunday then
  // Monday out of order). If planStart isn't a Monday, week 1 is simply a
  // short partial week (as few as one day), and week 2 properly starts on
  // the next Monday.
  const planStartDow = (planStart.getDay() + 6) % 7; // 0 = Monday, ..., 6 = Sunday
  const firstMonday = new Date(planStart);
  firstMonday.setDate(planStart.getDate() - planStartDow);

  const raceDate = currentGoals?.race_date ? new Date(currentGoals.race_date + 'T00:00:00') : null;
  let weeksTotal = 8;
  if (raceDate && raceDate > planStart) {
    weeksTotal = Math.round((raceDate - planStart) / (7 * 86400000));
    weeksTotal = Math.max(8, Math.min(20, weeksTotal));
  }

  const phase4Weeks = Math.min(2, weeksTotal);
  const remaining = weeksTotal - phase4Weeks;
  const phase1Weeks = Math.ceil(remaining * 0.45);
  const phase2Weeks = Math.ceil(remaining * 0.30);
  const phase3Weeks = Math.max(0, remaining - phase1Weeks - phase2Weeks);

  function phaseForWeek(weekNumber){
    if (weekNumber <= phase1Weeks) return 1;
    if (weekNumber <= phase1Weeks + phase2Weeks) return 2;
    if (weekNumber <= phase1Weeks + phase2Weeks + phase3Weeks) return 3;
    return 4;
  }

  function constraintForDate(dateStr){
    return currentConstraints.find(c => dateStr >= c.start_date && dateStr <= c.end_date);
  }

  // Peak (best-week) session duration per discipline, derived from the
  // user's own race goal when set (a full race-split duration is
  // unrealistic as a regular training session, so it's scaled down and
  // clamped to a sane range), otherwise a generic fallback.
  const PEAK_DURATION_FALLBACK_MIN = { swim: 30, bike: 45, run: 35, strength: 30 };
  const PEAK_DURATION_CLAMP_MIN = { swim: [20, 60], bike: [30, 120], run: [20, 90] };
  // Floor applied after load-fraction scaling — below this a session isn't
  // really a workout, particularly for swim.
  const MIN_SESSION_DURATION = { swim: 25, bike: 25, run: 20, strength: 20 };
  function peakMinutesFor(discipline){
    if (discipline === 'strength') return PEAK_DURATION_FALLBACK_MIN.strength;
    const goalSec = currentGoals?.[`${discipline}_duration_sec`];
    if (!goalSec) return PEAK_DURATION_FALLBACK_MIN[discipline];
    const [floor, ceiling] = PEAK_DURATION_CLAMP_MIN[discipline];
    return Math.max(floor, Math.min(ceiling, (goalSec / 60) * 0.6));
  }

  // Weekly load fraction of peak duration: ramps 0.7 -> 1.0 across the
  // base/build/specific phases (3-weeks-up, 1-week-down recovery pattern),
  // then a flat deload for the taper phase. Floors are kept fairly high —
  // going much below this makes sessions (especially swim) too short to be
  // a real workout, and compounding a low ramp with the recovery-week
  // multiplier was pushing sessions all the way down to the length floor.
  const loadWeeks = phase1Weeks + phase2Weeks + phase3Weeks;
  function loadFractionForWeek(weekNumber){
    if (weekNumber > loadWeeks) return 0.6; // taper
    let fraction = 0.7 + 0.3 * (weekNumber / loadWeeks);
    if (weekNumber % 4 === 0) fraction *= 0.8; // recovery week
    return fraction;
  }

  // 80/20 polarized intensity: a repeating 5-slot cycle per discipline
  // (tracked continuously, not reset weekly) gives 1-in-5 hard sessions,
  // with one of the easy slots flagged as the week's long session.
  const disciplineOccurrence = Object.fromEntries(disciplines.map(d => [d, 0]));
  function workoutTypeFor(discipline){
    const slot = disciplineOccurrence[discipline] % 5;
    disciplineOccurrence[discipline]++;
    if (slot === 4) return 'Sortie longue';
    if (slot === 2) return 'Fractionné';
    return 'Endurance';
  }

  // The workout type is what actually defines duration, not the other way
  // around: a long session IS what "peak" means for the discipline, an
  // interval session is shorter despite being harder, and an easy session
  // sits in between. The week's load fraction then scales whichever base
  // this type gives.
  const TYPE_DURATION_FRACTION = { 'Sortie longue': 1, 'Endurance': 0.65, 'Fractionné': 0.55 };

  const trainingDaySet = new Set(trainingDays);

  // Smooth weighted round-robin: sports at a higher priority tier get
  // proportionally more sessions when there are more training days than
  // sports, and proportionally fewer when sports outnumber training days.
  // Weight comes directly from each sport's saved priority tier (1-3), so
  // sports sharing a tier get equal weight instead of every sport needing a
  // distinct rank.
  const disciplineWeights = disciplines.map(d => currentPreferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL);
  const disciplineCredit = new Array(disciplines.length).fill(0);

  function pickDiscipline(isAllowed){
    // Only accrue credit for disciplines eligible *today* — otherwise a
    // multi-week contrainte (e.g. "run only") lets every blocked discipline
    // pile up unspent credit for weeks, which then dominates picks for a
    // long stretch after the contrainte ends, effectively suppressing
    // whatever was constrained instead of resuming normally.
    const eligible = disciplines.map((_, i) => i).filter(i => isAllowed(disciplines[i]));
    if (eligible.length === 0) return null;

    eligible.forEach(i => { disciplineCredit[i] += disciplineWeights[i]; });
    const chosen = eligible.reduce((best, i) => disciplineCredit[i] > disciplineCredit[best] ? i : best, eligible[0]);
    const eligibleWeightTotal = eligible.reduce((sum, i) => sum + disciplineWeights[i], 0);
    disciplineCredit[chosen] -= eligibleWeightTotal;
    return disciplines[chosen];
  }

  let sessionCounter = 0;
  let orderIndexInWeek = 0;
  let lastWeekNumber = 0;
  const rows = [];
  // Every training-day date, grouped by week — used below to place Renfo
  // sessions, independent of whether a cardio session landed that day.
  const weekDates = new Map();

  // Generous day upper bound (planStart isn't necessarily a Monday, so the
  // first calendar week can be partial and "use up" days without covering a
  // full week) — the loop below stops itself once weekNumber exceeds
  // weeksTotal, which is what actually bounds the plan to its intended
  // length (otherwise the tail spills into an extra week that falls past
  // every phase boundary and silently extends the taper).
  const totalDays = (weeksTotal + 1) * 7;
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = new Date(planStart);
    date.setDate(planStart.getDate() + dayIndex);

    const daysSinceFirstMonday = Math.round((date - firstMonday) / 86400000);
    const weekNumber = Math.floor(daysSinceFirstMonday / 7) + 1;
    if (weekNumber > weeksTotal) break;

    const dow = DAY_OPTIONS[(date.getDay() + 6) % 7];
    if (!trainingDaySet.has(dow)) continue;

    if (weekNumber !== lastWeekNumber) {
      orderIndexInWeek = 0;
      lastWeekNumber = weekNumber;
    }

    const dateStr = ymd(date.getFullYear(), date.getMonth(), date.getDate());
    if (!weekDates.has(weekNumber)) weekDates.set(weekNumber, []);
    weekDates.get(weekNumber).push(dateStr);

    const constraint = constraintForDate(dateStr);
    const discipline = pickDiscipline(candidate => !constraint || constraint.allowed_disciplines.includes(candidate));
    if (!discipline) continue; // no allowed discipline available this day — skip it

    sessionCounter++;

    const tag = workoutTypeFor(discipline);
    const duration_min = Math.max(
      MIN_SESSION_DURATION[discipline],
      Math.round((peakMinutesFor(discipline) * TYPE_DURATION_FRACTION[tag] * loadFractionForWeek(weekNumber)) / 5) * 5
    );

    rows.push({
      session_key: `gen-${sessionCounter}`,
      week_number: weekNumber,
      phase: phaseForWeek(weekNumber),
      order_index: orderIndexInWeek,
      discipline,
      icon: DISCIPLINE_EMOJI[discipline],
      title: DISCIPLINE_LABELS[discipline],
      tag,
      duration_min,
      segments: [],
      session_date: dateStr,
    });
    orderIndexInWeek++;
  }

  // Renfo: fixed frequency per week, placed on that week's first N training
  // days (chronologically) rather than competing in the cardio rotation.
  // Not filtered by contraintes — those only ever restrict cardio disciplines
  // in the UI (the contrainte discipline picker no longer offers Renfo).
  const strengthPerWeek = Math.min(currentPreferences.strength_sessions_per_week || 0, trainingDays.length);
  if (strengthPerWeek > 0) {
    const strengthDuration = peakMinutesFor('strength');
    for (const [weekNumber, dates] of weekDates) {
      dates.slice(0, strengthPerWeek).forEach((dateStr, i) => {
        sessionCounter++;
        rows.push({
          session_key: `gen-${sessionCounter}`,
          week_number: weekNumber,
          phase: phaseForWeek(weekNumber),
          order_index: 1000 + i, // after that week's cardio sessions; exact value isn't meaningful, rendering sorts by date
          discipline: 'strength',
          icon: DISCIPLINE_EMOJI.strength,
          title: DISCIPLINE_LABELS.strength,
          tag: 'Renforcement',
          duration_min: strengthDuration,
          segments: [],
          session_date: dateStr,
        });
      });
    }
  }

  return rows;
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
  // prefixed "gen-") — never touch that. A previously *generated* plan is
  // safe to replace, so re-running onboarding actually regenerates instead
  // of silently keeping stale results from an earlier run.
  const hasRealPlan = existing.some(row => !row.session_key.startsWith('gen-'));
  if (hasRealPlan) return;

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

function renderTrainingPrefsPanel(){
  if (!currentPreferences) return;
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
    if (trainingPrefsStep === 3) {
      container.innerHTML = trainingPrefsStep3Html();
      renderStravaSettingsContent('wizard-strava-status', false);
      document.getElementById('prefs-back-btn').addEventListener('click', () => {
        trainingPrefsStep = 2;
        renderTrainingPrefsPanel();
      });
      document.getElementById('prefs-finish-btn').addEventListener('click', () => {
        finishOnboarding(document.getElementById('prefs-finish-btn'));
      });
    } else if (trainingPrefsStep === 2) {
      container.innerHTML = trainingPrefsStep2Html(currentPreferences, currentConstraints);
      renderConstraintList();
      wireContraintesSection();
      document.getElementById('prefs-back-btn').addEventListener('click', () => {
        trainingPrefsStep = 1;
        renderTrainingPrefsPanel();
      });
      document.getElementById('prefs-step2-next-btn').addEventListener('click', async () => {
        const nextBtn = document.getElementById('prefs-step2-next-btn');
        if (await isStravaVisible()) {
          trainingPrefsStep = 3;
          renderTrainingPrefsPanel();
        } else {
          await finishOnboarding(nextBtn);
        }
      });
    } else {
      container.innerHTML = trainingPrefsStep1Html(currentPreferences);
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
        trainingPrefsStep = 2;
        renderTrainingPrefsPanel();
      });
    }
    return;
  }

  container.innerHTML = trainingPrefsFullFormHtml(currentPreferences, currentConstraints);
  renderConstraintList();
  wireContraintesSection();
  attachDayCardHandlers();

  const selectedDays = new Set(currentPreferences.training_days);
  const preferredOrder = currentPreferences.preferred_disciplines.filter(d => CARDIO_DISCIPLINES.includes(d));
  const priorityMap = Object.fromEntries(preferredOrder.map(d => [d, currentPreferences.discipline_priority?.[d] || DEFAULT_PRIORITY_LEVEL]));
  const strengthState = { value: currentPreferences.strength_sessions_per_week || 0 };

  async function autoSavePrefs(){
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
  }

  toggleChipGroup('.day-check-btn', selectedDays, 'day', autoSavePrefs);
  wirePreferredDisciplines(preferredOrder, priorityMap, autoSavePrefs);
  wireStrengthFrequency(strengthState, autoSavePrefs);
}

let onboardingPrimaryHandler = null;
let onboardingDismissHandler = null;

function showOnboardingPopup({ title, text, primaryLabel, onPrimary, onDismiss }){
  // These popups are about the home page (race info / splits) — only show
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

  // Swap the handlers directly instead of cloning/replacing the buttons —
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

const RACE_SIZE_LABELS = { S: 'Sprint', M: 'M', L: 'L (70.3)', IRONMAN: 'Iron Man' };

const RACE_SIZE_DISTANCES = {
  S: { swim_distance_m: 750, bike_distance_km: 20, run_distance_km: 5 },
  M: { swim_distance_m: 1500, bike_distance_km: 40, run_distance_km: 10 },
  L: { swim_distance_m: 1900, bike_distance_km: 90, run_distance_km: 21.1 },
  IRONMAN: { swim_distance_m: 3800, bike_distance_km: 180, run_distance_km: 42.2 },
};

function raceInfoEditorHtml(goals){
  return `<div class="detail-title" style="margin-bottom:16px;">Mon triathlon</div>
    <div class="goal-field">
      <label>Nom</label>
      <input type="text" id="race-info-name" value="${escapeHtml(goals.name || '')}">
    </div>
    <div class="goal-field">
      <label>Date</label>
      <input type="date" id="race-info-date" value="${goals.race_date || ''}">
    </div>
    <div class="goal-field">
      <label>Format</label>
      <div class="race-size-options">${['S', 'M', 'L', 'IRONMAN']
        .map(sz => `<button type="button" class="race-size-btn${goals.size === sz ? ' active' : ''}" data-size="${sz}">${RACE_SIZE_LABELS[sz]}</button>`)
        .join('')}</div>
    </div>
    <button type="button" class="goal-save-btn" id="save-race-info-btn">Enregistrer</button>`;
}

function openRaceInfoEditor(){
  if (!currentGoals) return;
  let selectedSize = currentGoals.size;

  document.getElementById('detail-content').innerHTML = raceInfoEditorHtml(currentGoals);

  document.querySelectorAll('.race-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSize = btn.dataset.size;
      document.querySelectorAll('.race-size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('save-race-info-btn').addEventListener('click', async () => {
    const name = document.getElementById('race-info-name').value.trim() || null;
    const raceDate = document.getElementById('race-info-date').value || currentGoals.race_date;
    const sizeChanged = selectedSize !== currentGoals.size;
    const notYetConfigured = currentGoals.swim_distance_m == null;
    const distances = (sizeChanged || notYetConfigured) ? RACE_SIZE_DISTANCES[selectedSize] : {};

    const updated = { ...currentGoals, name, race_date: raceDate, size: selectedSize, ...distances, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('plan_race_goals').upsert(updated);
    if (error) {
      console.error('Erreur de sauvegarde des infos de course', error);
      return;
    }
    currentGoals = updated;
    renderRaceInfo(currentGoals);
    renderGoals(currentGoals);
    updateSplitLabels(currentGoals);
    closeDetail();
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
  return `<div class="exo-item"><b>${escapeHtml(ex.name)}</b>${tagsHtml} — ${escapeHtml(ex.description)}</div>`;
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
