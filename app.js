// ─── Config ───────────────────────────────────────────────────────────────────
const GITHUB_OWNER = 's1eepyc4t';
const GITHUB_REPO  = 'temp-mobile-app';
const GITHUB_BRANCH = 'main';
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

// ─── State ────────────────────────────────────────────────────────────────────
let githubToken = null;
let isUploading = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const setupScreen    = document.getElementById('setup-screen');
const appScreen      = document.getElementById('app-screen');
const tokenInput     = document.getElementById('token-input');
const saveTokenBtn   = document.getElementById('save-token-btn');
const setupError     = document.getElementById('setup-error');
const refreshBtn     = document.getElementById('refresh-btn');
const settingsBtn    = document.getElementById('settings-btn');
const addPhotoBtn    = document.getElementById('add-photo-btn');
const fileInput      = document.getElementById('file-input');
const galleryGrid    = document.getElementById('gallery-grid');
const emptyState     = document.getElementById('empty-state');
const loadingState   = document.getElementById('loading-state');
const uploadToast    = document.getElementById('upload-toast');
const toastMsg       = document.getElementById('toast-msg');
const successToast   = document.getElementById('success-toast');
const successMsg     = document.getElementById('success-msg');
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose  = document.getElementById('lightbox-close');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsSheet  = document.getElementById('settings-sheet');
const updateTokenBtn = document.getElementById('update-token-btn');
const logoutBtn      = document.getElementById('logout-btn');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  githubToken = localStorage.getItem('gh_token');
  if (githubToken) {
    showApp();
    await loadGallery();
  } else {
    showSetup();
  }

  // Register service worker
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

// ─── Token setup ─────────────────────────────────────────────────────────────
saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showSetupError('Please enter a token.');
    return;
  }

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
    // 200 = exists, 404 = repo accessible but file missing (also valid)
    return res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}

function showSetupError(msg) {
  setupError.textContent = msg;
  setupError.classList.remove('hidden');
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
  // Show newest first
  const reversed = [...photos].reverse();
  reversed.forEach((filename) => {
    const item = createGalleryItem(filename);
    galleryGrid.appendChild(item);
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
  img.addEventListener('error', () => {
    div.classList.add('broken');
  });

  div.appendChild(img);
  return div;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await loadGallery();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
});

// ─── Add Photo ────────────────────────────────────────────────────────────────
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
    showSuccess(
      uploaded === 1
        ? 'Photo uploaded to GitHub!'
        : `${uploaded} photos uploaded to GitHub!`
    );
    await loadGallery();
  }

  if (failed > 0) {
    alert(`${failed} photo(s) failed to upload. Check your token and try again.`);
  }
}

async function uploadFileToGitHub(file) {
  const base64 = await fileToBase64(file);
  const filename = generateFilename(file);

  // 1. Upload the image file
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

  // 2. Update photos.json
  await updatePhotosJson(filename);
}

async function updatePhotosJson(newFilename) {
  // Get current photos.json (need the SHA to update it)
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
  } catch {
    // photos.json doesn't exist yet — start fresh
  }

  // Add new filename (avoid duplicates)
  if (!currentPhotos.includes(newFilename)) {
    currentPhotos.push(newFilename);
  }

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

// ─── Utility: file → base64 ───────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:image/jpeg;base64,XXXXX" — strip the prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Utility: generate unique filename ───────────────────────────────────────
function generateFilename(file) {
  const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
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
  setTimeout(() => successToast.classList.add('hidden'), 3000);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(src, caption) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
  document.body.style.overflow = '';
}

// ─── Settings sheet ───────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsSheet.classList.remove('hidden');
  settingsOverlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    settingsSheet.classList.add('open');
  });
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

// ─── Pull to refresh (touch) ──────────────────────────────────────────────────
let touchStartY = 0;
let isPulling = false;

document.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', async (e) => {
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  const atTop = window.scrollY === 0;

  if (atTop && deltaY > 80 && !isUploading && !isPulling) {
    isPulling = true;
    refreshBtn.classList.add('spinning');
    await loadGallery();
    refreshBtn.classList.remove('spinning');
    isPulling = false;
  }
}, { passive: true });

// ─── Auto-refresh: poll for new photos every 30s when app is visible ──────────
let autoRefreshTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    if (!document.hidden && githubToken) {
      await silentRefresh();
    }
  }, 30000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function silentRefresh() {
  try {
    const photos = await fetchPhotosList();
    const currentItems = galleryGrid.querySelectorAll('.gallery-item');
    const currentCount = currentItems.length;
    if (photos.length > currentCount) {
      renderGallery(photos);
      showSuccess(`${photos.length - currentCount} new photo${photos.length - currentCount > 1 ? 's' : ''} synced`);
    }
  } catch {
    // silent — don't interrupt user
  }
}

// Restart polling when app becomes visible again (user switches back)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && githubToken) {
    silentRefresh();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
init();
