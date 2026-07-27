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

function escapeHtml(str){
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sessionCardHtml(s){
  const tagHtml = s.tag ? `<span class="tag">${escapeHtml(s.tag)}</span>` : '';
  const segsHtml = (s.segments || [])
    .map(seg => `<span class="seg"><b class="seg-label">${escapeHtml(seg.label)}</b> ${seg.text}</span>`)
    .join('');
  const altHtml = s.alt_note ? `<div class="alt">${s.alt_note}</div>` : '';

  return `<div class="wcard ${s.discipline}"><div class="wc-head"><span class="wc-title">${s.icon} ${escapeHtml(s.title)} ${tagHtml}</span><label class="wc-check"><input type="checkbox" class="session-check" data-key="${s.session_key}"${s.done ? ' checked' : ''}></label></div><p>${segsHtml}</p>${altHtml}</div>`;
}

function weekBlockHtml(weekNumber, sessions, isOpen){
  const label = WEEK_LABEL_OVERRIDES[weekNumber] || `Semaine S${weekNumber}`;
  const range = WEEK_DATE_RANGES[weekNumber];
  const datesHtml = range ? `<span class="week-dates">${formatWeekDates(range)}</span>` : '';
  const doneCount = sessions.filter(s => s.done).length;

  return `<details class="week-block" data-week="wk${weekNumber}"${isOpen ? ' open' : ''}><summary class="week-heading"><span>${label} ${datesHtml}</span><span class="week-right"><span class="week-count"><span class="wc-done">${doneCount}</span>/${sessions.length}</span><svg class="chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></summary><div class="week-grid">${sessions.map(sessionCardHtml).join('')}</div></details>`;
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

  attachCheckboxHandlers();
  document.querySelectorAll('.session-check').forEach(refreshCard);
  document.querySelectorAll('.week-block').forEach(refreshWeek);
  refreshProgress();
}

function attachCheckboxHandlers(){
  document.querySelectorAll('.session-check').forEach(cb => {
    cb.addEventListener('change', () => {
      refreshCard(cb);
      refreshWeek(weekBlockOf(cb));
      refreshProgress();
      saveCompletion(cb.dataset.key, cb.checked);
    });
  });
}

function cardOf(cb){ return cb.closest('.wcard, .reinf'); }
function weekBlockOf(cb){ return cb.closest('.week-block'); }

function refreshCard(cb){
  const card = cardOf(cb);
  if (card) card.classList.toggle('done', cb.checked);
}

function refreshWeek(block){
  if (!block) return;
  const boxes = block.querySelectorAll('.session-check');
  const done = Array.from(boxes).filter(b => b.checked).length;
  const el = block.querySelector('.wc-done');
  if (el) el.textContent = done;
}

function refreshProgress(){
  const now = new Date();

  const weeks = Array.from(document.querySelectorAll('.week-block')).map(block => ({
    week: parseInt(block.dataset.week.replace('wk', ''), 10),
    checkboxes: Array.from(block.querySelectorAll('.session-check')),
  }));

  const totalSessions = weeks.reduce((sum, w) => sum + w.checkboxes.length, 0);

  const expectedSessions = weeks.reduce(
    (sum, w) => sum + w.checkboxes.length * weekCreditFraction(w.week, now),
    0
  );
  const expectedPct = totalSessions ? (expectedSessions / totalSessions * 100) : 0;

  const done = weeks.reduce((sum, w) => sum + w.checkboxes.filter(cb => cb.checked).length, 0);
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
