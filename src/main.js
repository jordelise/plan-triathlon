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

async function renderStravaSettingsContent(){
  const el = document.getElementById('detail-content');
  try {
    const res = await fetch('/api/strava/status', { headers: await stravaAuthHeaders() });
    const data = await res.json();
    if (data.connected) {
      const who = data.athlete_name ? `Connecté à <b>Strava</b> en tant que <b>${escapeHtml(data.athlete_name)}</b>.` : 'Connecté à <b>Strava</b>.';
      el.innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div><p class="settings-status">${who}</p><button type="button" class="settings-btn disconnect" id="strava-disconnect-btn">Déconnecter</button>`;
      document.getElementById('strava-disconnect-btn').addEventListener('click', async () => {
        await fetch('/api/strava/disconnect', { headers: await stravaAuthHeaders() });
        renderStravaSettingsContent();
      });
    } else {
      el.innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div><p class="settings-status">Non connecté à <b>Strava</b>.</p><p class="settings-sub">Connecte ton compte Strava pour voir les vraies stats de tes séances.</p><a href="#" class="settings-btn connect" id="strava-connect-link">Connecter Strava</a>`;
      document.getElementById('strava-connect-link').addEventListener('click', (e) => {
        e.preventDefault();
        goToStravaConnect();
      });
    }
  } catch {
    el.innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div><p class="settings-status">Impossible de vérifier la connexion Strava.</p>`;
  }
}

function openStravaSettings(){
  document.getElementById('detail-content').innerHTML = `<div class="detail-title" style="margin-bottom:16px;">Applications connectées</div><p class="settings-status">Chargement de Strava…</p>`;
  openDetailOverlay();
  renderStravaSettingsContent();
}

document.getElementById('strava-settings-row').addEventListener('click', openStravaSettings);

function weekBlockHtml(weekNumber, sessions, isOpen){
  const label = `Semaine S${weekNumber}`;
  const range = WEEK_DATE_RANGES[weekNumber];
  const datesHtml = range ? `<span class="week-dates">${formatWeekDates(range)}</span>` : '';
  const doneCount = sessions.filter(s => s.done).length;
  const sorted = [...sessions].sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));

  return `<details class="week-block" data-week="wk${weekNumber}"${isOpen ? ' open' : ''}><summary class="week-heading"><span>${label} ${datesHtml}</span><span class="week-right"><span class="week-count"><span class="wc-done">${doneCount}</span>/${sessions.length}</span><svg class="chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="day-list">${sorted.map(dayRowHtml).join('')}</div></details>`;
}

async function loadAndRenderSessions(){
  const { data, error } = await supabase
    .from('plan_session_completions')
    .select('*')
    .order('week_number', { ascending: true })
    .order('order_index', { ascending: true });

  if (error) {
    console.error('Erreur de chargement', error);
    return;
  }

  sessionsByKey = new Map(data.map(s => [s.session_key, { ...s }]));

  const byPhase = new Map();
  for (const row of data) {
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
    .from('plan_session_completions')
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
    .from('plan_session_completions')
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

function parseMMSS(str){
  const [m, s] = str.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

function formatHMM(totalSec){
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseHMM(str){
  const [h, m] = str.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
}

function formatPacePer100(durationSec, distanceM){
  const per100Sec = durationSec / (distanceM / 100);
  const m = Math.floor(per100Sec / 60);
  const s = Math.round(per100Sec % 60);
  return `${m}'${String(s).padStart(2, '0')}`;
}

function parsePacePer100(str, distanceM){
  const match = str.match(/(\d+)['’](\d+)/);
  if (!match) return null;
  const per100Sec = Number(match[1]) * 60 + Number(match[2]);
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
  if (!match) return null;
  const perKmSec = Number(match[1]) * 60 + Number(match[2]);
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

function showOnboardingPopup({ title, text, primaryLabel, onPrimary }){
  const popup = document.getElementById('onboarding-popup');
  document.getElementById('onboarding-title').textContent = title;
  document.getElementById('onboarding-text').textContent = text;

  const primaryBtn = document.getElementById('onboarding-primary-btn');
  primaryBtn.textContent = primaryLabel;
  const dismissBtn = document.getElementById('onboarding-dismiss-btn');

  const newPrimaryBtn = primaryBtn.cloneNode(true);
  primaryBtn.replaceWith(newPrimaryBtn);
  const newDismissBtn = dismissBtn.cloneNode(true);
  dismissBtn.replaceWith(newDismissBtn);

  newPrimaryBtn.addEventListener('click', () => {
    popup.hidden = true;
    onPrimary();
  }, { once: true });
  newDismissBtn.addEventListener('click', () => {
    popup.hidden = true;
  }, { once: true });

  popup.hidden = false;
}

function maybeShowOnboardingPopup(goals){
  if (!goals.race_date || goals.swim_distance_m == null) {
    showOnboardingPopup({
      title: 'Configure ta course',
      text: 'Renseigne le nom, la date et le format de ton triathlon pour personnaliser ton plan et tes objectifs.',
      primaryLabel: 'Configurer maintenant',
      onPrimary: openRaceInfoEditor,
    });
    return;
  }

  const durations = [goals.swim_duration_sec, goals.t1_duration_sec, goals.bike_duration_sec, goals.t2_duration_sec, goals.run_duration_sec];
  if (durations.some(v => v == null)) {
    showOnboardingPopup({
      title: 'Définis tes objectifs de temps',
      text: 'Sur la page d\'accueil, tape sur chaque étape (nage, T1, vélo, T2, course) pour indiquer le temps ou l\'allure que tu vises.',
      primaryLabel: 'Compris',
      onPrimary: () => {},
    });
  }
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

  const paceInput = document.getElementById('edit-goal-pace');
  if (paceInput) {
    durationInput.addEventListener('change', () => {
      const sec = parseDuration(durationInput.value);
      paceInput.value = segment.pace.format({ ...currentGoals, [segment.durationField]: sec });
    });
    paceInput.addEventListener('change', () => {
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

  if (error) {
    console.error('Erreur de chargement des exercices', error);
    return;
  }

  exercisesByCategory = new Map();
  for (const ex of data) {
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
