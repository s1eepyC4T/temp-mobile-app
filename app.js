// ─── Config ───────────────────────────────────────────────────────────────────
const GITHUB_OWNER = 's1eepyc4t';
const GITHUB_REPO  = 'temp-mobile-app';
const GITHUB_BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

// ─── State ────────────────────────────────────────────────────────────────────
let githubToken = null;
let isUploading = false;
let bulkCancelled = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const setupScreen        = document.getElementById('setup-screen');
const appScreen          = document.getElementById('app-screen');
const tokenInput         = document.getElementById('token-input');
const saveTokenBtn       = document.getElementById('save-token-btn');
const setupError         = document.getElementById('setup-error');
const refreshBtn         = document.getElementById('refresh-btn');
const settingsBtn        = document.getElementById('settings-btn');
const addPhotoBtn        = document.getElementById('add-photo-btn');
const fileInput          = document.getElementById('file-input');
const bulkFileInput      = document.getElementById('bulk-file-input');
const galleryGrid        = document.getElementById('gallery-grid');
const emptyState         = document.getElementById('empty-state');
const loadingState       = document.getElementById('loading-state');
const uploadToast        = document.getElementById('upload-toast');
const toastMsg           = document.getElementById('toast-msg');
const successToast       = document.getElementById('success-toast');
const successMsg         = document.getElementById('success-msg');
const lightbox           = document.getElementById('lightbox');
const lightboxImg        = document.getElementById('lightbox-img');
const lightboxCaption    = document.getElementById('lightbox-caption');
const lightboxClose      = document.getElementById('lightbox-close');
const settingsOverlay    = document.getElementById('settings-overlay');
const settingsSheet      = document.getElementById('settings-sheet');
const updateTokenBtn     = document.getElementById('update-token-btn');
const logoutBtn          = document.getElementById('logout-btn');
const settingsImportBtn  = document.getElementById('settings-import-btn');
// Import banner
const importBanner       = document.getElementById('import-banner');
const importAllBtn       = document.getElementById('import-all-btn');
const importDismissBtn   = document.getElementById('import-dismiss-btn');
// Bulk progress screen
const bulkProgressScreen = document.getElementById('bulk-progress-screen');
const bulkProgressBar    = document.getElementById('bulk-progress-bar');
const bulkProgressSub    = document.getElementById('bulk-progress-subtitle');
const bulkCount          = document.getElementById('bulk-count');
const bulkPercent        = document.getElementById('bulk-percent');
const bulkCurrentFile    = document.getElementById('bulk-current-file');
const bulkFailedCount    = document.getElementById('bulk-failed-count');
const bulkFailedText     = document.getElementById('bulk-failed-text');
const bulkCancelBtn      = document.getElementById('bulk-cancel-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  githubToken = localStorage.getItem('gh_token');
  if (githubToken) {
    showApp();
    await loadGallery();
    maybeShowImportBanner();
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

// ─── Token setup ──────────────────────────────────────────────────────────────
saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) { showSetupError('Please enter a token.'); return; }

  saveTokenBtn.textContent = 'Verifying...';
  saveTokenBtn.disabled = true;
  setupError.classList.add('hidden');

  const valid = await verifyToken(token);
  if (valid) {
    localStorage.setItem('gh_token', token);
    githubToken = token;
    saveTokenBtn.textContent = 'Connect';
    saveTokenBtn.disabled = false;
    showApp();
    await loadGallery();
    maybeShowImportBanner();
  } else {
    saveTokenBtn.textContent = 'Connect';
    saveTokenBtn.disabled = false;
    showSetupError('Token invalid or missing repo access. Check permissions and try again.');
  }
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTokenBtn.click();
});

async function verifyToken(token) {
  try {
    const res = await fetch(`${API_BASE}/photos.json`, {
      headers: { Authorization: `token ${token}` }
    });
    return res.status === 200 || res.status === 404;
  } catch { return false; }
}

function showSetupError(msg) {
  setupError.textContent = msg;
  setupError.classList.remove('hidden');
}

// ─── Import banner ────────────────────────────────────────────────────────────
function maybeShowImportBanner() {
  // Show once: if the user hasn't dismissed it and hasn't done a bulk import
  const dismissed = localStorage.getItem('import_banner_dismissed');
  const done      = localStorage.getItem('bulk_import_done');
  if (!dismissed && !done) {
    importBanner.classList.remove('hidden');
  }
}

importDismissBtn.addEventListener('click', () => {
  importBanner.classList.add('hidden');
  localStorage.setItem('import_banner_dismissed', '1');
});

importAllBtn.addEventListener('click', () => {
  importBanner.classList.add('hidden');
  triggerBulkImport();
});

settingsImportBtn.addEventListener('click', () => {
  closeSettings();
  triggerBulkImport();
});

function triggerBulkImport() {
  bulkFileInput.value = '';
  bulkFileInput.click();
}

bulkFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  await runBulkImport(files);
});

// ─── Bulk import engine ───────────────────────────────────────────────────────
async function runBulkImport(files) {
  bulkCancelled = false;
  isUploading = true;
  addPhotoBtn.disabled = true;

  // Show the full-screen progress overlay
  bulkProgressScreen.classList.remove('hidden');
  bulkFailedCount.classList.add('hidden');
  bulkProgressSub.textContent = `Uploading to GitHub...`;
  updateBulkProgress(0, files.length, 0);

  let uploaded = 0;
  let failed   = 0;
  const failedNames = [];

  // We batch photos.json updates — collect all filenames, write once at the end
  // But we still need to upload images one by one (GitHub API rate limits)
  const uploadedFilenames = [];

  for (let i = 0; i < files.length; i++) {
    if (bulkCancelled) break;

    const file = files[i];
    bulkCurrentFile.textContent = file.name;
    updateBulkProgress(i, files.length, failed);

    try {
      const filename = await uploadImageOnly(file);
      uploadedFilenames.push(filename);
      uploaded++;
    } catch (err) {
      console.error('Bulk upload failed for', file.name, err);
      failed++;
      failedNames.push(file.name);
    }

    updateBulkProgress(i + 1, files.length, failed);
  }

  // Write all filenames to photos.json in one go
  if (uploadedFilenames.length > 0) {
    bulkProgressSub.textContent = 'Saving photo list...';
    bulkCurrentFile.textContent = 'Updating photos.json';
    try {
      await appendToPhotosJson(uploadedFilenames);
    } catch (err) {
      console.error('Failed to update photos.json:', err);
    }
  }

  // Done
  isUploading = false;
  addPhotoBtn.disabled = false;

  if (bulkCancelled) {
    bulkProgressScreen.classList.add('hidden');
    if (uploaded > 0) {
      showSuccess(`Cancelled — ${uploaded} photo${uploaded > 1 ? 's' : ''} uploaded so far`);
      await loadGallery();
    }
    return;
  }

  // Show completion state
  bulkProgressSub.textContent = uploaded > 0
    ? `Done! ${uploaded} photo${uploaded > 1 ? 's' : ''} synced to GitHub`
    : 'No photos uploaded';
  bulkCurrentFile.textContent = '';
  updateBulkProgress(files.length, files.length, failed);

  if (failed > 0) {
    bulkFailedText.textContent = `${failed} failed — tap + to retry them`;
    bulkFailedCount.classList.remove('hidden');
  }

  bulkCancelBtn.textContent = 'Done';
  localStorage.setItem('bulk_import_done', '1');

  await loadGallery();
}

function updateBulkProgress(done, total, failed) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  bulkProgressBar.style.width = `${pct}%`;
  bulkCount.textContent  = `${done} / ${total}`;
  bulkPercent.textContent = `${pct}%`;
  if (failed > 0) {
    bulkFailedText.textContent = `${failed} failed`;
    bulkFailedCount.classList.remove('hidden');
  }
}

bulkCancelBtn.addEventListener('click', () => {
  if (isUploading) {
    bulkCancelled = true;
    bulkCancelBtn.textContent = 'Cancelling...';
    bulkCancelBtn.disabled = true;
  } else {
    // "Done" state
    bulkProgressScreen.classList.add('hidden');
    bulkCancelBtn.textContent = 'Cancel';
    bulkCancelBtn.disabled = false;
  }
});

// Upload only the image file — returns the generated filename
async function uploadImageOnly(file) {
  const base64   = await fileToBase64(file);
  const filename = generateFilename(file);

  const res = await fetch(`${API_BASE}/photos/${filename}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Bulk import: ${filename}`,
      content: base64,
      branch: GITHUB_BRANCH,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${res.status}`);
  }

  return filename;
}

// Append a batch of filenames to photos.json in one API call
async function appendToPhotosJson(newFilenames) {
  let currentPhotos = [];
  let fileSha = null;

  try {
    const res = await fetch(`${API_BASE}/photos.json`, {
      headers: { Authorization: `token ${githubToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      fileSha = data.sha;
      const decoded = atob(data.content.replace(/\n/g, ''));
      currentPhotos = JSON.parse(decoded);
    }
  } catch { /* start fresh */ }

  for (const name of newFilenames) {
    if (!currentPhotos.includes(name)) currentPhotos.push(name);
  }

  const newContent = btoa(JSON.stringify(currentPhotos, null, 2));
  const body = {
    message: `Bulk import: add ${newFilenames.length} photos`,
    content: newContent,
    branch: GITHUB_BRANCH,
  };
  if (fileSha) body.sha = fileSha;

  const res = await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('photos.json update failed: ' + (err.message || res.status));
  }
}

// ─── Gallery loading ──────────────────────────────────────────────────────────
async function loadGallery() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  galleryGrid.innerHTML = '';

  try {
    const photos = await fetchPhotosList();
    loadingState.classList.add('hidden');
    if (photos.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    renderGallery(photos);
  } catch (err) {
    loadingState.classList.add('hidden');
    emptyState.classList.remove('hidden');
    console.error('Failed to load gallery:', err);
  }
}

async function fetchPhotosList() {
  const url = `${RAW_BASE}/photos.json?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function renderGallery(photos) {
  galleryGrid.innerHTML = '';
  const reversed = [...photos].reverse();
  reversed.forEach((filename) => {
    galleryGrid.appendChild(createGalleryItem(filename));
  });
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

// ─── Refresh ──────────────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await loadGallery();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
});

// ─── Add Photo (single / small batch via FAB) ─────────────────────────────────
addPhotoBtn.addEventListener('click', () => {
  if (isUploading) return;
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  await uploadFiles(files);
});

async function uploadFiles(files) {
  isUploading = true;
  addPhotoBtn.disabled = true;

  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    showToast(`Uploading ${i + 1} of ${files.length}...`);
    try {
      await uploadFileToGitHub(file);
      uploaded++;
    } catch (err) {
      console.error('Upload failed for', file.name, err);
      failed++;
    }
  }

  hideToast();
  isUploading = false;
  addPhotoBtn.disabled = false;

  if (uploaded > 0) {
    showSuccess(uploaded === 1 ? 'Photo uploaded!' : `${uploaded} photos uploaded!`);
    await loadGallery();
  }
  if (failed > 0) {
    alert(`${failed} photo(s) failed to upload. Check your token and try again.`);
  }
}

async function uploadFileToGitHub(file) {
  const base64   = await fileToBase64(file);
  const filename = generateFilename(file);

  const uploadRes = await fetch(`${API_BASE}/photos/${filename}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Add photo: ${filename}`,
      content: base64,
      branch: GITHUB_BRANCH,
    }),
  });

  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${uploadRes.status}`);
  }

  await updatePhotosJson(filename);
}

async function updatePhotosJson(newFilename) {
  let currentPhotos = [];
  let fileSha = null;

  try {
    const res = await fetch(`${API_BASE}/photos.json`, {
      headers: { Authorization: `token ${githubToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      fileSha = data.sha;
      const decoded = atob(data.content.replace(/\n/g, ''));
      currentPhotos = JSON.parse(decoded);
    }
  } catch { /* start fresh */ }

  if (!currentPhotos.includes(newFilename)) currentPhotos.push(newFilename);

  const newContent = btoa(JSON.stringify(currentPhotos, null, 2));
  const body = {
    message: `Update photos list: add ${newFilename}`,
    content: newContent,
    branch: GITHUB_BRANCH,
  };
  if (fileSha) body.sha = fileSha;

  const res = await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error('Failed to update photos.json: ' + (errData.message || res.status));
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateFilename(file) {
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  const rand = Math.random().toString(36).slice(2, 6);
  return `photo_${ts}_${rand}.${ext}`;
}

// ─── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg) {
  toastMsg.textContent = msg;
  uploadToast.classList.remove('hidden');
  successToast.classList.add('hidden');
}

function hideToast() {
  uploadToast.classList.add('hidden');
}

function showSuccess(msg) {
  successMsg.textContent = msg;
  successToast.classList.remove('hidden');
  setTimeout(() => successToast.classList.add('hidden'), 3500);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(src, caption) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
  document.body.style.overflow = '';
}

// ─── Settings sheet ───────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsSheet.classList.remove('hidden');
  settingsOverlay.classList.remove('hidden');
  requestAnimationFrame(() => settingsSheet.classList.add('open'));
});

function closeSettings() {
  settingsSheet.classList.remove('open');
  setTimeout(() => {
    settingsSheet.classList.add('hidden');
    settingsOverlay.classList.add('hidden');
  }, 300);
}

settingsOverlay.addEventListener('click', closeSettings);

updateTokenBtn.addEventListener('click', () => {
  closeSettings();
  localStorage.removeItem('gh_token');
  githubToken = null;
  tokenInput.value = '';
  showSetup();
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('Clear your GitHub token and return to setup?')) return;
  localStorage.removeItem('gh_token');
  githubToken = null;
  closeSettings();
  showSetup();
});

// ─── Pull to refresh ──────────────────────────────────────────────────────────
let touchStartY = 0;
let isPulling = false;

document.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', async (e) => {
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  const atTop  = window.scrollY === 0;
  if (atTop && deltaY > 80 && !isUploading && !isPulling) {
    isPulling = true;
    refreshBtn.classList.add('spinning');
    await loadGallery();
    refreshBtn.classList.remove('spinning');
    isPulling = false;
  }
}, { passive: true });

// ─── Auto-refresh: poll every 30s + on visibility change ──────────────────────
let autoRefreshTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    if (!document.hidden && githubToken && !isUploading) {
      await silentRefresh();
    }
  }, 30000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

async function silentRefresh() {
  try {
    const photos       = await fetchPhotosList();
    const currentCount = galleryGrid.querySelectorAll('.gallery-item').length;
    if (photos.length > currentCount) {
      renderGallery(photos);
      const diff = photos.length - currentCount;
      showSuccess(`${diff} new photo${diff > 1 ? 's' : ''} synced`);
    }
  } catch { /* silent */ }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && githubToken && !isUploading) silentRefresh();
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
