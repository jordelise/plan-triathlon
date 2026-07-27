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
  let activePhase = null;

  document.querySelectorAll('.week-list').forEach(container => {
    const phase = Number(container.dataset.phase);
    const weeks = byPhase.get(phase);
    if (!weeks) return;
    if (weeks.has(activeWeek)) activePhase = phase;
    const weekNumbers = Array.from(weeks.keys()).sort((a, b) => a - b);
    container.innerHTML = weekNumbers
      .map(wn => weekBlockHtml(wn, weeks.get(wn), wn === activeWeek))
      .join('');
  });

  if (activePhase) {
    const tabInput = document.getElementById(`t${activePhase}`);
    if (tabInput) tabInput.checked = true;
  }

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
