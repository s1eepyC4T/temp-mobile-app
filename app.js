// ─── Config ───────────────────────────────────────────────────────────────────
const GITHUB_OWNER  = 's1eepyc4t';
const GITHUB_REPO   = 'temp-mobile-app';
const GITHUB_BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const CURRENCY = '฿';
const DAILY_BUDGET = 1000; // soft budget for the progress bar (฿ per day)

// ─── State ────────────────────────────────────────────────────────────────────
let githubToken  = null;
let openaiKey    = null;
let isUploading  = false;
let bulkCancelled = false;
let currentTab   = 'gallery';
let pendingScanData = null; // { base64, dataUrl, file }

// ─── DOM: common ──────────────────────────────────────────────────────────────
const setupScreen     = document.getElementById('setup-screen');
const appScreen       = document.getElementById('app-screen');
const tokenInput      = document.getElementById('token-input');
const openaiKeyInput  = document.getElementById('openai-key-input');
const saveTokenBtn    = document.getElementById('save-token-btn');
const setupError      = document.getElementById('setup-error');
const appTitle        = document.getElementById('app-title');
const refreshBtn      = document.getElementById('refresh-btn');
const settingsBtn     = document.getElementById('settings-btn');
const uploadToast     = document.getElementById('upload-toast');
const toastMsg        = document.getElementById('toast-msg');
const successToast    = document.getElementById('success-toast');
const successMsg      = document.getElementById('success-msg');
const lightbox        = document.getElementById('lightbox');
const lightboxImg     = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose   = document.getElementById('lightbox-close');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsSheet   = document.getElementById('settings-sheet');
const updateTokenBtn  = document.getElementById('update-token-btn');
const updateOpenaiBtn = document.getElementById('update-openai-btn');
const logoutBtn       = document.getElementById('logout-btn');
const settingsImportBtn = document.getElementById('settings-import-btn');

// ─── DOM: gallery tab ─────────────────────────────────────────────────────────
const addPhotoBtn      = document.getElementById('add-photo-btn');
const fileInput        = document.getElementById('file-input');
const bulkFileInput    = document.getElementById('bulk-file-input');
const galleryGrid      = document.getElementById('gallery-grid');
const emptyState       = document.getElementById('empty-state');
const loadingState     = document.getElementById('loading-state');
const importBanner     = document.getElementById('import-banner');
const importAllBtn     = document.getElementById('import-all-btn');
const importDismissBtn = document.getElementById('import-dismiss-btn');
const bulkProgressScreen = document.getElementById('bulk-progress-screen');
const bulkProgressBar  = document.getElementById('bulk-progress-bar');
const bulkProgressSub  = document.getElementById('bulk-progress-subtitle');
const bulkCount        = document.getElementById('bulk-count');
const bulkPercent      = document.getElementById('bulk-percent');
const bulkCurrentFile  = document.getElementById('bulk-current-file');
const bulkFailedCount  = document.getElementById('bulk-failed-count');
const bulkFailedText   = document.getElementById('bulk-failed-text');
const bulkCancelBtn    = document.getElementById('bulk-cancel-btn');

// ─── DOM: spending tab ────────────────────────────────────────────────────────
const spendingTotal    = document.getElementById('spending-total');
const spendingCount    = document.getElementById('spending-count');
const spendingDateLbl  = document.getElementById('spending-date-label');
const spendingBarFill  = document.getElementById('spending-bar-fill');
const spendingBarLabel = document.getElementById('spending-bar-label');
const noOpenaiBanner   = document.getElementById('no-openai-banner');
const slipEmpty        = document.getElementById('slip-empty');
const slipList         = document.getElementById('slip-list');
const clearTodayBtn    = document.getElementById('clear-today-btn');
const scanSlipBtn      = document.getElementById('scan-slip-btn');
const slipFileInput    = document.getElementById('slip-file-input');
const slipListTitle    = document.getElementById('slip-list-title');

// ─── DOM: scan result sheet ───────────────────────────────────────────────────
const scanOverlay      = document.getElementById('scan-overlay');
const scanSheet        = document.getElementById('scan-sheet');
const scanLoading      = document.getElementById('scan-loading');
const scanResult       = document.getElementById('scan-result');
const scanPreviewImg   = document.getElementById('scan-preview-img');
const scanAmount       = document.getElementById('scan-amount');
const scanMerchant     = document.getElementById('scan-merchant');
const scanMerchantRow  = document.getElementById('scan-merchant-row');
const scanNoteInput    = document.getElementById('scan-note-input');
const scanErrorRow     = document.getElementById('scan-error-row');
const scanErrorMsg     = document.getElementById('scan-error-msg');
const scanDiscardBtn   = document.getElementById('scan-discard-btn');
const scanSaveBtn      = document.getElementById('scan-save-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  githubToken = localStorage.getItem('gh_token');
  openaiKey   = localStorage.getItem('openai_key');

  if (githubToken) {
    showApp();
    await loadGallery();
    // First launch: auto-trigger bulk import silently if never done
    if (!localStorage.getItem('bulk_import_done')) {
      triggerBulkImport();
    }
    renderSpending();
  } else {
    showSetup();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ─── Screen helpers ───────────────────────────────────────────────────────────
function showSetup() {
  setupScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
  stopAutoRefresh();
}

function showApp() {
  setupScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  startAutoRefresh();
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));

  if (tab === 'gallery') {
    appTitle.textContent = 'Gallery';
    refreshBtn.classList.remove('hidden');
  } else {
    appTitle.textContent = 'Spending';
    refreshBtn.classList.add('hidden');
    renderSpending();
  }
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
    showSetupError('GitHub token invalid or missing repo access. Check permissions.');
    return;
  }

  localStorage.setItem('gh_token', token);
  githubToken = token;
  if (oKey) {
    localStorage.setItem('openai_key', oKey);
    openaiKey = oKey;
  }

  saveTokenBtn.textContent = 'Connect';
  saveTokenBtn.disabled = false;
  showApp();
  await loadGallery();
  // First launch: auto-trigger bulk import silently
  if (!localStorage.getItem('bulk_import_done')) {
    triggerBulkImport();
  }
  renderSpending();
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

// ─── Import banner (removed — import is now fully automatic and silent) ───────
function maybeShowImportBanner() {} // kept for safety, no-op

importDismissBtn.addEventListener('click', () => {
  importBanner.classList.add('hidden');
});
importAllBtn.addEventListener('click', () => {
  importBanner.classList.add('hidden');
  triggerBulkImport();
});
settingsImportBtn.addEventListener('click', () => { closeSettings(); triggerBulkImport(); });

function triggerBulkImport() { bulkFileInput.value = ''; bulkFileInput.click(); }
bulkFileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  if (files.length) await runBulkImport(files);
});

// ─── Bulk import engine (silent — no UI feedback to user) ─────────────────────
async function runBulkImport(files) {
  if (isUploading) return;
  bulkCancelled = false;
  isUploading = true;
  addPhotoBtn.disabled = true;

  // Show a subtle syncing indicator on the FAB only
  addPhotoBtn.classList.add('syncing');

  const uploadedFilenames = [];

  for (let i = 0; i < files.length; i++) {
    if (bulkCancelled) break;
    try {
      const fn = await uploadImageOnly(files[i]);
      uploadedFilenames.push(fn);
    } catch (err) {
      console.error('Bulk upload failed silently:', files[i].name, err);
    }
  }

  if (uploadedFilenames.length > 0) {
    try { await appendToPhotosJson(uploadedFilenames); } catch (e) { console.error(e); }
  }

  isUploading = false;
  addPhotoBtn.disabled = false;
  addPhotoBtn.classList.remove('syncing');
  localStorage.setItem('bulk_import_done', '1');

  // Silently refresh the gallery to show newly uploaded photos
  if (uploadedFilenames.length > 0) {
    await loadGallery();
  }
}

// ─── (bulk progress UI removed — import is silent) ───────────────────────────
// bulkCancelBtn kept in HTML for potential future use but not wired up

async function uploadImageOnly(file) {
  const base64 = await fileToBase64(file);
  const filename = generateFilename(file);
  const res = await fetch(`${API_BASE}/photos/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Bulk import: ${filename}`, content: base64, branch: GITHUB_BRANCH }),
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
  const body = { message: `Bulk import: add ${newFilenames.length} photos`, content: btoa(JSON.stringify(currentPhotos, null, 2)), branch: GITHUB_BRANCH };
  if (fileSha) body.sha = fileSha;
  const res = await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT', headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || res.status); }
}

// ─── Gallery loading ──────────────────────────────────────────────────────────
async function loadGallery() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  galleryGrid.innerHTML = '';
  try {
    const photos = await fetchPhotosList();
    loadingState.classList.add('hidden');
    if (photos.length === 0) { emptyState.classList.remove('hidden'); return; }
    renderGallery(photos);
  } catch (err) {
    loadingState.classList.add('hidden');
    emptyState.classList.remove('hidden');
    console.error(err);
  }
}

async function fetchPhotosList() {
  const res = await fetch(`${RAW_BASE}/photos.json?t=${Date.now()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function renderGallery(photos) {
  galleryGrid.innerHTML = '';
  [...photos].reverse().forEach(fn => galleryGrid.appendChild(createGalleryItem(fn)));
}

function createGalleryItem(filename) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  const img = document.createElement('img');
  img.src = `${RAW_BASE}/photos/${encodeURIComponent(filename)}?t=${Date.now()}`;
  img.alt = filename;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('click', () => openLightbox(img.src, filename));
  img.addEventListener('error', () => div.classList.add('broken'));
  div.appendChild(img);
  return div;
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await loadGallery();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
});

addPhotoBtn.addEventListener('click', () => { if (!isUploading) { fileInput.value = ''; fileInput.click(); } });
fileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  if (files.length) await uploadFiles(files);
});

async function uploadFiles(files) {
  isUploading = true;
  addPhotoBtn.disabled = true;
  addPhotoBtn.classList.add('syncing');

  for (let i = 0; i < files.length; i++) {
    try {
      await uploadFileToGitHub(files[i]);
    } catch (err) {
      console.error('Upload failed silently:', files[i].name, err);
    }
  }

  addPhotoBtn.classList.remove('syncing');
  isUploading = false;
  addPhotoBtn.disabled = false;

  // Silently refresh gallery — no toast
  await loadGallery();
}

async function uploadFileToGitHub(file) {
  const base64 = await fileToBase64(file);
  const filename = generateFilename(file);
  const res = await fetch(`${API_BASE}/photos/${filename}`, {
    method: 'PUT', headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Add photo: ${filename}`, content: base64, branch: GITHUB_BRANCH }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || res.status); }
  await updatePhotosJson(filename);
}

async function updatePhotosJson(newFilename) {
  let currentPhotos = [], fileSha = null;
  try {
    const res = await fetch(`${API_BASE}/photos.json`, { headers: { Authorization: `token ${githubToken}` } });
    if (res.ok) {
      const data = await res.json();
      fileSha = data.sha;
      currentPhotos = JSON.parse(atob(data.content.replace(/\n/g, '')));
    }
  } catch {}
  if (!currentPhotos.includes(newFilename)) currentPhotos.push(newFilename);
  const body = { message: `Update photos list: add ${newFilename}`, content: btoa(JSON.stringify(currentPhotos, null, 2)), branch: GITHUB_BRANCH };
  if (fileSha) body.sha = fileSha;
  const res = await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT', headers: { Authorization: `token ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || res.status); }
}

// ─── Spending: data helpers ───────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().slice(0, 10); } // "YYYY-MM-DD"

function loadSlips() {
  try { return JSON.parse(localStorage.getItem(`slips_${todayKey()}`) || '[]'); } catch { return []; }
}

function saveSlips(slips) {
  localStorage.setItem(`slips_${todayKey()}`, JSON.stringify(slips));
}

function addSlip(slip) {
  const slips = loadSlips();
  slips.push(slip);
  saveSlips(slips);
}

// ─── Spending: render ─────────────────────────────────────────────────────────
function renderSpending() {
  const slips = loadSlips();
  const total = slips.reduce((s, x) => s + (x.amount || 0), 0);
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  spendingDateLbl.textContent = dateStr;
  spendingTotal.textContent = `${CURRENCY}${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  spendingCount.textContent = `${slips.length} slip${slips.length !== 1 ? 's' : ''}`;

  // Progress bar vs soft budget
  const pct = Math.min((total / DAILY_BUDGET) * 100, 100);
  spendingBarFill.style.width = `${pct}%`;
  spendingBarFill.className = `spending-bar-fill${pct >= 100 ? ' over' : pct >= 75 ? ' warn' : ''}`;

  if (total === 0) {
    spendingBarLabel.textContent = `No spending recorded yet`;
  } else if (pct >= 100) {
    spendingBarLabel.textContent = `Over daily budget of ${CURRENCY}${DAILY_BUDGET.toLocaleString()}`;
  } else {
    const left = DAILY_BUDGET - total;
    spendingBarLabel.textContent = `${CURRENCY}${left.toLocaleString('th-TH', { minimumFractionDigits: 2 })} left of ${CURRENCY}${DAILY_BUDGET.toLocaleString()} budget`;
  }

  // No OpenAI key banner
  noOpenaiBanner.classList.toggle('hidden', !!openaiKey);

  // Slip list
  clearTodayBtn.classList.toggle('hidden', slips.length === 0);
  slipEmpty.classList.toggle('hidden', slips.length > 0);
  slipList.classList.toggle('hidden', slips.length === 0);
  slipListTitle.textContent = `Slips scanned today (${slips.length})`;

  slipList.innerHTML = '';
  [...slips].reverse().forEach((slip, idx) => {
    const realIdx = slips.length - 1 - idx;
    slipList.appendChild(createSlipCard(slip, realIdx, slips.length));
  });
}

function createSlipCard(slip, idx, total) {
  const card = document.createElement('div');
  card.className = 'slip-card';

  const left = document.createElement('div');
  left.className = 'slip-card-left';

  const thumb = document.createElement('div');
  thumb.className = 'slip-thumb';
  if (slip.dataUrl) {
    const img = document.createElement('img');
    img.src = slip.dataUrl;
    img.alt = 'slip';
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
  delBtn.addEventListener('click', () => deleteSlip(idx));

  right.appendChild(amount);
  right.appendChild(delBtn);

  card.appendChild(left);
  card.appendChild(right);
  return card;
}

function deleteSlip(idx) {
  const slips = loadSlips();
  slips.splice(idx, 1);
  saveSlips(slips);
  renderSpending();
}

clearTodayBtn.addEventListener('click', () => {
  if (!confirm('Clear all slips for today?')) return;
  localStorage.removeItem(`slips_${todayKey()}`);
  renderSpending();
});

// ─── Spending: scan slip ──────────────────────────────────────────────────────
scanSlipBtn.addEventListener('click', () => {
  if (!openaiKey) {
    alert('Please add your OpenAI API key in Settings first.');
    return;
  }
  slipFileInput.value = '';
  slipFileInput.click();
});

slipFileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  await handleSlipFile(file);
});

async function handleSlipFile(file) {
  const base64  = await fileToBase64(file);
  const dataUrl = await fileToDataUrl(file);
  pendingScanData = { base64, dataUrl, file };
  openScanSheet();
  await runAIScan(base64, dataUrl);
}

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
  setTimeout(() => {
    scanSheet.classList.add('hidden');
    scanOverlay.classList.add('hidden');
    pendingScanData = null;
  }, 300);
}

scanOverlay.addEventListener('click', closeScanSheet);
scanDiscardBtn.addEventListener('click', closeScanSheet);

async function runAIScan(base64, dataUrl) {
  try {
    const result = await callGPT4oVision(base64);
    showScanResult(result, dataUrl);
  } catch (err) {
    showScanError(err.message);
  }
}

async function callGPT4oVision(base64) {
  const prompt = `You are a receipt/payment slip scanner. Examine this image and extract:
1. The total amount paid (number only, no currency symbol)
2. The merchant name or description (brief, in English or transliterated Thai)

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{"amount": 123.50, "merchant": "Merchant Name"}

If you cannot find the amount, use null. If you cannot find the merchant, use null.
The slip may be in Thai — extract the numeric total amount regardless of language.`;

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `OpenAI error ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const raw  = data.choices?.[0]?.message?.content?.trim() || '';

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(cleaned); } catch {
    throw new Error('AI returned unexpected format. Try again.');
  }

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
    scanErrorMsg.textContent = 'Could not detect an amount. You can enter it manually below.';
    // Allow manual override via note
    scanNoteInput.placeholder = 'Enter amount manually, e.g. 250';
    scanSaveBtn.disabled = false;
  } else {
    scanAmount.textContent = `${CURRENCY}${result.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    scanErrorRow.classList.add('hidden');
  }

  if (result.merchant) {
    scanMerchant.textContent = result.merchant;
    scanMerchantRow.classList.remove('hidden');
  } else {
    scanMerchantRow.classList.add('hidden');
  }

  // Store result on save button for retrieval
  scanSaveBtn._scanResult = result;
}

function showScanError(msg) {
  scanLoading.classList.add('hidden');
  scanResult.classList.remove('hidden');
  scanPreviewImg.src = pendingScanData?.dataUrl || '';
  scanAmount.textContent = '—';
  scanMerchantRow.classList.add('hidden');
  scanErrorRow.classList.remove('hidden');
  scanErrorMsg.textContent = msg || 'Scan failed. Check your OpenAI key.';
  scanNoteInput.placeholder = 'Add a note or description';
  scanSaveBtn._scanResult = { amount: null, merchant: null };
}

scanSaveBtn.addEventListener('click', () => {
  const result = scanSaveBtn._scanResult || { amount: null, merchant: null };
  const noteVal = scanNoteInput.value.trim();

  // If amount was null, try parsing note as a number
  let amount = result.amount;
  if (amount === null && noteVal) {
    const parsed = parseFloat(noteVal.replace(/[^\d.]/g, ''));
    if (!isNaN(parsed)) amount = parsed;
  }

  if (amount === null) {
    scanErrorRow.classList.remove('hidden');
    scanErrorMsg.textContent = 'No amount found. Enter the amount in the note field.';
    return;
  }

  const slip = {
    amount,
    merchant: result.merchant || null,
    note: noteVal || null,
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    dataUrl: pendingScanData?.dataUrl || null,
  };

  addSlip(slip);
  closeScanSheet();
  switchTab('spending');
  showSuccess(`${CURRENCY}${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} added to today`);
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

// ─── Toasts ───────────────────────────────────────────────────────────────────
function showToast(msg) {
  toastMsg.textContent = msg;
  uploadToast.classList.remove('hidden');
  successToast.classList.add('hidden');
}
function hideToast() { uploadToast.classList.add('hidden'); }
function showSuccess(msg) {
  successMsg.textContent = msg;
  successToast.classList.remove('hidden');
  setTimeout(() => successToast.classList.add('hidden'), 3500);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(src, caption) {
  lightboxImg.src = src; lightboxCaption.textContent = caption;
  lightbox.classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); closeScanSheet(); } });
function closeLightbox() {
  lightbox.classList.add('hidden'); lightboxImg.src = ''; document.body.style.overflow = '';
}

// ─── Settings ─────────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsSheet.classList.remove('hidden'); settingsOverlay.classList.remove('hidden');
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
  const key = prompt('Enter your OpenAI API key (sk-...):', '');
  if (key && key.trim()) {
    openaiKey = key.trim();
    localStorage.setItem('openai_key', openaiKey);
    showSuccess('OpenAI key saved');
    renderSpending();
  }
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('Clear your GitHub token and return to setup?')) return;
  localStorage.removeItem('gh_token'); githubToken = null;
  closeSettings(); showSetup();
});

// ─── Pull to refresh ──────────────────────────────────────────────────────────
let touchStartY = 0, isPulling = false;
document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', async e => {
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  if (window.scrollY === 0 && deltaY > 80 && !isUploading && !isPulling && currentTab === 'gallery') {
    isPulling = true;
    refreshBtn.classList.add('spinning');
    await loadGallery();
    refreshBtn.classList.remove('spinning');
    isPulling = false;
  }
}, { passive: true });

// ─── Auto-refresh ─────────────────────────────────────────────────────────────
let autoRefreshTimer = null;
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    if (!document.hidden && githubToken && !isUploading && currentTab === 'gallery') await silentRefresh();
  }, 30000);
}
function stopAutoRefresh() { if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; } }
async function silentRefresh() {
  try {
    const photos  = await fetchPhotosList();
    const current = galleryGrid.querySelectorAll('.gallery-item').length;
    if (photos.length > current) {
      renderGallery(photos);
      // No toast — update is invisible to the user
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && githubToken && !isUploading) {
    if (currentTab === 'gallery') silentRefresh();
    else if (currentTab === 'spending') renderSpending();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
