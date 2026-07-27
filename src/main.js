import { supabase } from './supabaseClient.js';

const WEEK_LABEL_OVERRIDES = { 11: 'Semaine S11 — dernière semaine' };

// Calendar date range covered by each plan week: real Monday-Sunday weeks,
// starting from the Monday on/before the plan's first training day (Jul 21,
// a Tuesday, so week 1 is Jul 20-26). Week 11 extends to race day (Oct 11)
// as an intentionally longer taper block, matching the original plan.
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
  11: ['2026-09-28', '2026-10-11'],
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

const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 12 9 17 20 6"/></svg>';

function dayRowHtml(s){
  const d = new Date(s.session_date + 'T00:00:00');
  return `<div class="day-row"><div class="day-badge"><div class="day-name">${FR_WEEKDAYS[d.getDay()]}</div><div class="day-num">${d.getDate()}</div></div><button type="button" class="day-card ${s.discipline}${s.done ? ' done' : ''}" data-key="${s.session_key}"><span class="day-card-icon">${s.icon}</span><span class="day-card-title">${escapeHtml(s.title)}</span><span class="day-card-check">${s.done ? CHECK_ICON_SVG : ''}</span></button></div>`;
}

function sessionDetailHtml(s){
  const tagHtml = s.tag ? `<span class="tag">${escapeHtml(s.tag)}</span>` : '';
  const segsHtml = (s.segments || [])
    .map(seg => `<span class="seg"><b class="seg-label">${escapeHtml(seg.label)}</b> ${seg.text}</span>`)
    .join('');
  const altHtml = s.alt_note ? `<div class="alt">${s.alt_note}</div>` : '';

  return `<div class="detail-head"><span class="detail-icon">${s.icon}</span><div><div class="detail-title">${escapeHtml(s.title)}</div>${tagHtml ? `<div class="detail-tag">${tagHtml}</div>` : ''}</div></div><p class="detail-segments">${segsHtml}</p>${altHtml}<label class="detail-done-toggle"><input type="checkbox" id="detail-done-checkbox" data-key="${s.session_key}"${s.done ? ' checked' : ''}> Marquer comme fait</label>`;
}

function weekBlockHtml(weekNumber, sessions, isOpen){
  const label = WEEK_LABEL_OVERRIDES[weekNumber] || `Semaine S${weekNumber}`;
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
    if (!weeks) return;
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

  const checkbox = document.getElementById('detail-done-checkbox');
  checkbox.addEventListener('change', () => {
    const key = checkbox.dataset.key;
    const sess = sessionsByKey.get(key);
    sess.done = checkbox.checked;
    saveCompletion(key, checkbox.checked);
    updateDayCardDone(key, checkbox.checked);
    refreshWeekCounts();
    refreshProgress();
  });

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail(){
  document.getElementById('detail-overlay').classList.remove('open');
}

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

loadAndRenderSessions();
loadAndRenderExercises();
loadAndRenderGoals();

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
  document.getElementById('split-swim-duration').textContent = '~' + formatMMSS(goals.swim_duration_sec);
  document.getElementById('split-swim-pace').textContent = formatPacePer100(goals.swim_duration_sec, goals.swim_distance_m) + '/100m';
  document.getElementById('split-t1-duration').textContent = '~' + formatMMSS(goals.t1_duration_sec);
  document.getElementById('split-bike-duration').textContent = '~' + formatHMM(goals.bike_duration_sec);
  document.getElementById('split-bike-speed').textContent = formatSpeedKmh(goals.bike_duration_sec, goals.bike_distance_km) + ' km/h';
  document.getElementById('split-t2-duration').textContent = '~' + formatMMSS(goals.t2_duration_sec);
  document.getElementById('split-run-duration').textContent = '~' + formatMMSS(goals.run_duration_sec);
  document.getElementById('split-run-pace').textContent = formatPacePerKm(goals.run_duration_sec, goals.run_distance_km) + '/km';

  const totalMin = Math.round(
    (goals.swim_duration_sec + goals.t1_duration_sec + goals.bike_duration_sec + goals.t2_duration_sec + goals.run_duration_sec) / 60
  );
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  document.getElementById('split-total').textContent = `≈ ${h}h${String(m).padStart(2, '0')}`;
}

async function loadAndRenderGoals(){
  const { data, error } = await supabase.from('plan_race_goals').select('*').eq('id', 1).single();
  if (error) {
    console.error('Erreur de chargement des objectifs', error);
    return;
  }
  currentGoals = data;
  renderGoals(currentGoals);
}

function goalsEditorHtml(goals){
  return `<div class="detail-title" style="margin-bottom:16px;">Objectifs visés</div>
    <div class="goal-field">
      <label>Natation — durée (mm:ss)</label>
      <input type="text" id="edit-swim-duration" value="${formatMMSS(goals.swim_duration_sec)}">
      <label>Natation — allure (m'ss/100m)</label>
      <input type="text" id="edit-swim-pace" value="${formatPacePer100(goals.swim_duration_sec, goals.swim_distance_m)}">
    </div>
    <div class="goal-field">
      <label>T1 — durée (mm:ss)</label>
      <input type="text" id="edit-t1-duration" value="${formatMMSS(goals.t1_duration_sec)}">
    </div>
    <div class="goal-field">
      <label>Vélo — durée (h:mm)</label>
      <input type="text" id="edit-bike-duration" value="${formatHMM(goals.bike_duration_sec)}">
      <label>Vélo — vitesse (km/h)</label>
      <input type="text" id="edit-bike-speed" value="${formatSpeedKmh(goals.bike_duration_sec, goals.bike_distance_km)}">
    </div>
    <div class="goal-field">
      <label>T2 — durée (mm:ss)</label>
      <input type="text" id="edit-t2-duration" value="${formatMMSS(goals.t2_duration_sec)}">
    </div>
    <div class="goal-field">
      <label>Course — durée (mm:ss)</label>
      <input type="text" id="edit-run-duration" value="${formatMMSS(goals.run_duration_sec)}">
      <label>Course — allure (m'ss/km)</label>
      <input type="text" id="edit-run-pace" value="${formatPacePerKm(goals.run_duration_sec, goals.run_distance_km)}">
    </div>
    <button type="button" class="goal-save-btn" id="save-goals-btn">Enregistrer</button>`;
}

function openGoalsEditor(){
  if (!currentGoals) return;

  document.getElementById('detail-content').innerHTML = goalsEditorHtml(currentGoals);

  const swimDurationInput = document.getElementById('edit-swim-duration');
  const swimPaceInput = document.getElementById('edit-swim-pace');
  swimDurationInput.addEventListener('change', () => {
    const sec = parseMMSS(swimDurationInput.value);
    swimPaceInput.value = formatPacePer100(sec, currentGoals.swim_distance_m);
  });
  swimPaceInput.addEventListener('change', () => {
    const sec = parsePacePer100(swimPaceInput.value, currentGoals.swim_distance_m);
    if (sec) swimDurationInput.value = formatMMSS(sec);
  });

  const bikeDurationInput = document.getElementById('edit-bike-duration');
  const bikeSpeedInput = document.getElementById('edit-bike-speed');
  bikeDurationInput.addEventListener('change', () => {
    const sec = parseHMM(bikeDurationInput.value);
    bikeSpeedInput.value = formatSpeedKmh(sec, currentGoals.bike_distance_km);
  });
  bikeSpeedInput.addEventListener('change', () => {
    const sec = parseSpeedKmh(bikeSpeedInput.value, currentGoals.bike_distance_km);
    if (sec) bikeDurationInput.value = formatHMM(sec);
  });

  const runDurationInput = document.getElementById('edit-run-duration');
  const runPaceInput = document.getElementById('edit-run-pace');
  runDurationInput.addEventListener('change', () => {
    const sec = parseMMSS(runDurationInput.value);
    runPaceInput.value = formatPacePerKm(sec, currentGoals.run_distance_km);
  });
  runPaceInput.addEventListener('change', () => {
    const sec = parsePacePerKm(runPaceInput.value, currentGoals.run_distance_km);
    if (sec) runDurationInput.value = formatMMSS(sec);
  });

  document.getElementById('save-goals-btn').addEventListener('click', async () => {
    const updated = {
      id: 1,
      swim_distance_m: currentGoals.swim_distance_m,
      swim_duration_sec: parseMMSS(swimDurationInput.value),
      t1_duration_sec: parseMMSS(document.getElementById('edit-t1-duration').value),
      bike_distance_km: currentGoals.bike_distance_km,
      bike_duration_sec: parseHMM(bikeDurationInput.value),
      t2_duration_sec: parseMMSS(document.getElementById('edit-t2-duration').value),
      run_distance_km: currentGoals.run_distance_km,
      run_duration_sec: parseMMSS(runDurationInput.value),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('plan_race_goals').upsert(updated);
    if (error) {
      console.error('Erreur de sauvegarde des objectifs', error);
      return;
    }

    currentGoals = updated;
    renderGoals(currentGoals);
    closeDetail();
  });

  document.getElementById('detail-overlay').classList.add('open');
}

document.getElementById('edit-goals-btn').addEventListener('click', openGoalsEditor);

function exerciseItemHtml(ex){
  return `<div class="exo-item"><b>${escapeHtml(ex.name)}</b> — ${escapeHtml(ex.description)}</div>`;
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

  document.querySelectorAll('[data-exercise-category]').forEach(container => {
    const category = container.dataset.exerciseCategory;
    container.innerHTML = data
      .filter(ex => ex.category === category)
      .map(exerciseItemHtml)
      .join('');
  });
}

function updateCountdown(){
  const target = new Date('2026-10-11T10:00:00');
  const now = new Date();
  let diff = Math.max(0, target - now);

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
