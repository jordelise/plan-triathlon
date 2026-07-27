import { supabase } from './supabaseClient.js';

const checkboxes = Array.from(document.querySelectorAll('.session-check'));

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
  const start = new Date('2026-07-21T00:00:00');
  const end = new Date('2026-10-11T00:00:00');
  const now = new Date();
  const expectedPct = Math.max(0, Math.min(100, (now - start) / (end - start) * 100));
  const done = checkboxes.filter(cb => cb.checked).length;
  const actualPct = checkboxes.length ? (done / checkboxes.length * 100) : 0;

  const expectedFill = document.getElementById('progress-expected-fill');
  const actualFill = document.getElementById('progress-actual-fill');
  const expectedVal = document.getElementById('progress-expected-val');
  const actualVal = document.getElementById('progress-actual-val');

  if (expectedFill) expectedFill.style.width = expectedPct + '%';
  if (actualFill) actualFill.style.width = actualPct + '%';
  if (expectedVal) expectedVal.textContent = Math.round(expectedPct) + '%';
  if (actualVal) actualVal.textContent = Math.round(actualPct) + '%';
}

function refreshAll(){
  checkboxes.forEach(refreshCard);
  document.querySelectorAll('.week-block').forEach(refreshWeek);
  refreshProgress();
}

async function loadCompletions(){
  const { data, error } = await supabase
    .from('plan_session_completions')
    .select('session_key, done');

  if (error) {
    console.error('Erreur de chargement', error);
    return;
  }

  const doneKeys = new Set(data.filter(row => row.done).map(row => row.session_key));
  checkboxes.forEach(cb => {
    cb.checked = doneKeys.has(cb.dataset.key);
  });
  refreshAll();
}

async function saveCompletion(sessionKey, done){
  const { error } = await supabase
    .from('plan_session_completions')
    .upsert(
      { session_key: sessionKey, done, updated_at: new Date().toISOString() },
      { onConflict: 'session_key' }
    );

  if (error) console.error('Erreur de sauvegarde', error);
}

checkboxes.forEach(cb => {
  cb.addEventListener('change', () => {
    refreshCard(cb);
    refreshWeek(weekBlockOf(cb));
    refreshProgress();
    saveCompletion(cb.dataset.key, cb.checked);
  });
});

loadCompletions();

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
