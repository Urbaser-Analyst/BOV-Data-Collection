/* ==========================================================
   FieldTrack — app.js
   Talks to the Apps Script backend defined in config.js (API_URL)
   ========================================================== */
const SESSION_MS = 12 * 60 * 60 * 1000;
const LS_KEY = 'fieldtrack_session';
const state = {
  token: null,
  userId: null,
  employeeName: null,
  employeeId: null,
  loginAt: null,
  assignments: [],   // merged assignment+entry rows from backend
  drafts: {},        // key -> {wet,dry,sanitary,dhw} in-progress edits
  searchTerm: ''
};
/* ---------------- DOM refs ---------------- */
const $ = (id) => document.getElementById(id);
const viewLogin = $('view-login');
const viewDashboard = $('view-dashboard');
/* ============================================================
   API helper — POST as text/plain to avoid CORS preflight on
   Apps Script web apps.
   ============================================================ */
async function api(action, payload) {
  const body = Object.assign({ action }, payload || {});
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Network error (' + res.status + ')');
  const json = await res.json();
  return json;
}
/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(message, type) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3200);
}
/* ============================================================
   SESSION
   ============================================================ */
function saveSession() {
  localStorage.setItem(LS_KEY, JSON.stringify({
    token: state.token,
    userId: state.userId,
    employeeName: state.employeeName,
    employeeId: state.employeeId,
    loginAt: state.loginAt
  }));
}
function loadSession() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (!s.token || !s.loginAt) return false;
    if (Date.now() - s.loginAt > SESSION_MS) {
      localStorage.removeItem(LS_KEY);
      return false;
    }
    Object.assign(state, s);
    return true;
  } catch (e) {
    return false;
  }
}
function clearSession() {
  localStorage.removeItem(LS_KEY);
  Object.assign(state, { token: null, userId: null, employeeName: null, employeeId: null, loginAt: null, assignments: [], drafts: {} });
}
let sessionInterval = null;
function startSessionTimer() {
  clearInterval(sessionInterval);
  tickSession();
  sessionInterval = setInterval(tickSession, 1000);
}
function tickSession() {
  const remaining = state.loginAt + SESSION_MS - Date.now();
  if (remaining <= 0) {
    clearInterval(sessionInterval);
    toast('Your 12-hour session has expired. Please sign in again.', 'error');
    doLogout();
    return;
  }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  $('sessionTimer').textContent =
    String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  $('sessionPill').classList.toggle('warn', remaining < 30 * 60 * 1000);
}
/* ============================================================
   VIEW SWITCHING
   ============================================================ */
function showDashboard() {
  viewLogin.hidden = true;
  viewDashboard.hidden = false;
  $('userName').textContent = state.employeeName || state.userId;
  $('userIdLabel').textContent = 'ID ' + state.userId;
  $('userAvatar').textContent = String(state.employeeName || state.userId).trim().charAt(0).toUpperCase();
  startSessionTimer();
  loadAssignments();
}
function showLogin() {
  viewDashboard.hidden = true;
  viewLogin.hidden = false;
  $('userId').focus();
}
/* ============================================================
   LOGIN
   ============================================================ */
$('togglePw').addEventListener('click', () => {
  const pw = $('password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
});
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = $('userId').value.trim();
  const password = $('password').value;
  const btn = $('loginBtn');
  const err = $('loginError');
  err.hidden = true;
  setBtnLoading(btn, true);
  try {
    const res = await api('login', { userId, password });
    if (!res.success) {
      err.textContent = res.error || 'Login failed.';
      err.hidden = false;
      setBtnLoading(btn, false);
      return;
    }
    state.token = res.token;
    state.userId = res.userId;
    state.employeeId = res.employeeId;
    state.employeeName = res.employeeName;
    state.loginAt = Date.now();
    saveSession();
    setBtnLoading(btn, false);
    showDashboard();
  } catch (ex) {
    err.textContent = 'Could not reach the server. Check your connection and the API URL in config.js.';
    err.hidden = false;
    setBtnLoading(btn, false);
  }
});
function setBtnLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-label').style.opacity = loading ? '0' : '1';
  btn.querySelector('.btn-spinner').hidden = !loading;
}
$('logoutBtn').addEventListener('click', doLogout);
function doLogout() {
  clearInterval(sessionInterval);
  clearSession();
  showLogin();
  $('login-form').reset();
}
/* ============================================================
   LOAD ASSIGNMENTS
   ============================================================ */
async function loadAssignments() {
  $('loadingState').hidden = false;
  $('emptyState').hidden = true;
  $('groupsContainer').innerHTML = '';
  try {
    const res = await api('getAssignments', { userId: state.userId, token: state.token });
    if (!res.success) {
      if (res.error === 'SESSION_EXPIRED') { toast('Session expired. Please sign in again.', 'error'); doLogout(); return; }
      toast(res.error || 'Could not load assignments.', 'error');
      $('loadingState').hidden = true;
      return;
    }
    state.assignments = res.assignments || [];
    $('loadingState').hidden = true;
    renderAll();
  } catch (ex) {
    $('loadingState').hidden = true;
    toast('Network error while loading assignments.', 'error');
  }
}
/* ============================================================
   RENDER
   ============================================================ */
function renderAll() {
  renderKpis();
  renderAssignGroups();
  renderCompletedTable();
}
function renderKpis() {
  const total = state.assignments.length;
  const done = state.assignments.filter(a => a.status === 'completed').length;
  const pending = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('kpiTotal').textContent = total;
  $('kpiDone').textContent = done;
  $('kpiPending').textContent = pending;
  $('kpiPercent').textContent = pct + '%';
  const circumference = 2 * Math.PI * 27;
  const ring = $('ringFill');
  ring.style.strokeDasharray = circumference.toFixed(1);
  ring.style.strokeDashoffset = (circumference - (pct / 100) * circumference).toFixed(1);
  const sums = state.assignments.reduce((acc, a) => {
    if (a.status === 'completed') {
      acc.wet += Number(a.wet) || 0;
      acc.dry += Number(a.dry) || 0;
      acc.san += Number(a.sanitary) || 0;
      acc.dhw += Number(a.dhw) || 0;
    }
    return acc;
  }, { wet: 0, dry: 0, san: 0, dhw: 0 });
  $('kpiWasteTotals').textContent = `${sums.wet} / ${sums.dry} / ${sums.san} / ${sums.dhw}`;
}
function matchesSearch(a) {
  if (!state.searchTerm) return true;
  const t = state.searchTerm.toLowerCase();
  return [a.facility, a.shift, a.zone, a.ward, a.vid].some(v => String(v).toLowerCase().includes(t));
}

/* ---------------- Grouped assignment cards (mobile-friendly) ----------------
   Groups rows by Facility + Shift + Zone + Ward. Each group renders as its own
   card: a header showing those 4 shared fields, and a compact table underneath
   listing only what varies per row — VID, Wet, Dry, Sanitary, DHW, Status, Action.
   A user with multiple Facility/Shift/Zone/Ward combinations simply gets
   multiple stacked cards.
------------------------------------------------------------------------------- */
function groupAssignments(rows) {
  const groups = [];
  const indexByKey = {};
  rows.forEach((a) => {
    const gKey = [a.facility, a.shift, a.zone, a.ward].join('||');
    if (!(gKey in indexByKey)) {
      indexByKey[gKey] = groups.length;
      groups.push({ gKey, facility: a.facility, shift: a.shift, zone: a.zone, ward: a.ward, rows: [] });
    }
    groups[indexByKey[gKey]].rows.push(a);
  });
  return groups;
}

function renderAssignGroups() {
  const container = $('groupsContainer');
  const rows = state.assignments.filter(matchesSearch);
  container.innerHTML = '';

  $('emptyState').hidden = state.assignments.length !== 0;

  const groups = groupAssignments(rows);

  groups.forEach((g) => {
    const groupDone = g.rows.filter(r => r.status === 'completed').length;
    const card = document.createElement('div');
    card.className = 'assign-group';

    card.innerHTML = `
      <div class="assign-group-header">
        <div class="assign-group-title">
          <span class="agh-item"><span class="agh-label">Facility</span><span class="agh-value">${escapeHtml(g.facility)}</span></span>
          <span class="agh-item"><span class="agh-label">Shift</span><span class="agh-value">${escapeHtml(g.shift)}</span></span>
          <span class="agh-item"><span class="agh-label">Zone</span><span class="agh-value">${escapeHtml(g.zone)}</span></span>
          <span class="agh-item"><span class="agh-label">Ward</span><span class="agh-value">${escapeHtml(g.ward)}</span></span>
        </div>
        <span class="assign-group-count">${groupDone}/${g.rows.length} done</span>
      </div>
      <div class="table-wrap group-table-wrap">
        <table class="assign-table group-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>VID</th>
              <th>Wet</th>
              <th>Dry</th>
              <th>Sanitary</th>
              <th>DHW</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    const tbody = card.querySelector('tbody');
    g.rows.forEach((a) => {
      const draft = state.drafts[a.key] || { wet: a.wet, dry: a.dry, sanitary: a.sanitary, dhw: a.dhw };
      const tr = document.createElement('tr');
      tr.className = a.status === 'completed' ? 'row-complete' : '';
      tr.dataset.key = a.key;
      tr.innerHTML = `
        <td><span class="status-badge ${a.status}">${a.status === 'completed' ? '✓ Done' : '◷ Pending'}</span></td>
        <td class="vid-cell">${escapeHtml(a.vid)}</td>
        <td>${numInput(a.key, 'wet', draft.wet)}</td>
        <td>${numInput(a.key, 'dry', draft.dry)}</td>
        <td>${numInput(a.key, 'sanitary', draft.sanitary)}</td>
        <td>${numInput(a.key, 'dhw', draft.dhw)}</td>
        <td><button class="row-submit-btn ${a.status === 'completed' ? 'edit-mode' : ''}" data-key="${a.key}">
          ${a.status === 'completed' ? 'Update' : 'Submit'}
        </button></td>
      `;
      tbody.appendChild(tr);
    });

    container.appendChild(card);
  });

  container.querySelectorAll('.num-input').forEach(inp => {
    inp.addEventListener('input', onDraftChange);
  });
  container.querySelectorAll('.row-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => submitRows([btn.dataset.key], btn));
  });
}

function numInput(key, field, value) {
  const v = (value === null || value === undefined) ? '' : value;
  return `<input type="number" min="0" step="1" class="num-input" data-key="${key}" data-field="${field}" value="${v}" placeholder="0" />`;
}
function onDraftChange(e) {
  const key = e.target.dataset.key;
  const field = e.target.dataset.field;
  if (!state.drafts[key]) {
    const a = state.assignments.find(x => x.key === key);
    state.drafts[key] = { wet: a.wet, dry: a.dry, sanitary: a.sanitary, dhw: a.dhw };
  }
  state.drafts[key][field] = e.target.value;
  e.target.classList.remove('invalid');
}
function renderCompletedTable() {
  const completed = state.assignments.filter(a => a.status === 'completed');
  $('completedPanel').hidden = completed.length === 0;
  const tbody = $('completedTableBody');
  tbody.innerHTML = completed.map(a => `
    <tr>
      <td>${escapeHtml(a.entryId || '')}</td>
      <td>${a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</td>
      <td>${escapeHtml(a.facility)}</td>
      <td>${escapeHtml(a.shift)}</td>
      <td>${escapeHtml(a.zone)}</td>
      <td>${escapeHtml(a.ward)}</td>
      <td>${escapeHtml(a.vid)}</td>
      <td>${escapeHtml(a.wet)}</td>
      <td>${escapeHtml(a.dry)}</td>
      <td>${escapeHtml(a.sanitary)}</td>
      <td>${escapeHtml(a.dhw)}</td>
    </tr>
  `).join('');
}
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
/* ============================================================
   VALIDATION + SUBMIT
   ============================================================ */
function readRowValues(key) {
  const wrapRow = document.querySelector(`.group-table tr[data-key="${CSS.escape(key)}"]`);
  const inputs = wrapRow.querySelectorAll('.num-input');
  const values = {};
  inputs.forEach(i => { values[i.dataset.field] = i.value; });
  return { values, inputs };
}
function validateValues(values) {
  const fields = ['wet', 'dry', 'sanitary', 'dhw'];
  const problems = [];
  fields.forEach(f => {
    const raw = values[f];
    if (raw === '' || raw === null || raw === undefined) { problems.push(f); return; }
    const n = Number(raw);
    if (isNaN(n) || n < 0) problems.push(f);
  });
  return problems;
}
async function submitRows(keys, triggerBtn) {
  const payloadEntries = [];
  const invalidByRow = {};
  keys.forEach(key => {
    const a = state.assignments.find(x => x.key === key);
    const { values, inputs } = readRowValues(key);
    const problems = validateValues(values);
    inputs.forEach(i => i.classList.toggle('invalid', problems.includes(i.dataset.field)));
    if (problems.length) {
      invalidByRow[key] = problems;
      return;
    }
    payloadEntries.push({
      facility: a.facility, shift: a.shift, zone: a.zone, ward: a.ward, vid: a.vid,
      wet: Number(values.wet), dry: Number(values.dry), sanitary: Number(values.sanitary), dhw: Number(values.dhw)
    });
  });
  if (Object.keys(invalidByRow).length) {
    toast('Every field must be filled with a number ≥ 0 before submitting.', 'error');
    return;
  }
  if (!payloadEntries.length) {
    toast('Nothing to submit.', 'error');
    return;
  }
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Saving…'; }
  try {
    const res = await api('submitEntries', { userId: state.userId, token: state.token, entries: payloadEntries });
    if (!res.success) {
      if (res.error === 'SESSION_EXPIRED') { toast('Session expired. Please sign in again.', 'error'); doLogout(); return; }
      toast(res.error || 'Submission failed.', 'error');
      return;
    }
    const failed = (res.results || []).filter(r => !r.success);
    const okCount = (res.results || []).filter(r => r.success).length;
    if (failed.length) {
      toast(`${okCount} saved, ${failed.length} failed validation.`, 'error');
    } else {
      toast(okCount > 1 ? `${okCount} entries saved.` : 'Entry saved.', 'success');
    }
    keys.forEach(k => delete state.drafts[k]);
    await loadAssignments();
    flashRows(keys);
  } catch (ex) {
    toast('Network error while submitting.', 'error');
  } finally {
    if (triggerBtn) { triggerBtn.disabled = false; }
  }
}
function flashRows(keys) {
  keys.forEach(key => {
    const row = document.querySelector(`.group-table tr[data-key="${CSS.escape(key)}"]`);
    if (row) {
      row.classList.add('row-flash');
      setTimeout(() => row.classList.remove('row-flash'), 1000);
    }
  });
}
$('submitAllBtn').addEventListener('click', () => {
  const btn = $('submitAllBtn');
  const keysWithData = state.assignments
    .filter(a => {
      const d = state.drafts[a.key];
      if (!d) return false;
      return ['wet','dry','sanitary','dhw'].some(f => String(d[f]).trim() !== '');
    })
    .map(a => a.key);
  if (!keysWithData.length) {
    toast('Fill in at least one row before submitting.', 'error');
    return;
  }
  setBtnLoading(btn, true);
  submitRows(keysWithData, null).finally(() => setBtnLoading(btn, false));
});
$('searchBox').addEventListener('input', (e) => {
  state.searchTerm = e.target.value.trim();
  renderAssignGroups();
});
/* ============================================================
   INIT
   ============================================================ */
(function init() {
  if (loadSession()) {
    showDashboard();
  } else {
    showLogin();
  }
})();
