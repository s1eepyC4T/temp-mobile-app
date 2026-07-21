/**
 * Cloudflare Worker — Photo Upload Relay
 *
 * Receives a raw image file (multipart/form-data or raw binary) from the
 * iOS Shortcut, encodes it to Base64, and pushes it to the GitHub repo.
 *
 * Environment variables (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   GITHUB_TOKEN  — Personal Access Token with Contents read+write on the repo
 *   UPLOAD_SECRET — A secret string you choose; the iOS Shortcut must send this
 *                   as the "X-Upload-Secret" header to prevent unauthorized uploads
 */

const GITHUB_OWNER  = 's1eepyC4T';
const GITHUB_REPO   = 'temp-mobile-app';
const GITHUB_BRANCH = 'main';
const API_BASE      = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

export default {
  async fetch(request, env) {
    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    // ── Only accept POST /upload ────────────────────────────────────────────
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/upload') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
    }

    // ── Auth: check secret header ───────────────────────────────────────────
    const secret = request.headers.get('X-Upload-Secret');
    if (!env.UPLOAD_SECRET || secret !== env.UPLOAD_SECRET) {
      return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 401);
    }

    if (!env.GITHUB_TOKEN) {
      return corsResponse(JSON.stringify({ error: 'Server misconfigured: missing GITHUB_TOKEN' }), 500);
    }

    try {
      // ── Read image bytes ──────────────────────────────────────────────────
      let imageBytes;
      let filename;
      const contentType = request.headers.get('Content-Type') || '';

      if (contentType.includes('multipart/form-data')) {
        // iOS Shortcut sends multipart form
        const formData = await request.formData();
        const file = formData.get('photo');
        if (!file) {
          return corsResponse(JSON.stringify({ error: 'No photo field in form data' }), 400);
        }
        imageBytes = new Uint8Array(await file.arrayBuffer());
        filename = formData.get('filename') || generateFilename(file.name || 'photo.jpg');
      } else {
        // Raw binary body
        imageBytes = new Uint8Array(await request.arrayBuffer());
        filename = request.headers.get('X-Filename') || generateFilename('photo.jpg');
      }

      if (!imageBytes || imageBytes.length === 0) {
        return corsResponse(JSON.stringify({ error: 'Empty image body' }), 400);
      }

      // ── Base64 encode ─────────────────────────────────────────────────────
      const base64 = uint8ToBase64(imageBytes);

      // ── Upload image to GitHub ────────────────────────────────────────────
      const uploadRes = await fetch(`${API_BASE}/photos/${filename}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'photo-gallery-worker',
        },
        body: JSON.stringify({
          message: `Auto-sync: add ${filename}`,
          content: base64,
          branch: GITHUB_BRANCH,
        }),
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        return corsResponse(
          JSON.stringify({ error: 'GitHub upload failed', detail: errData.message || uploadRes.status }),
          502
        );
      }

      // ── Update photos.json ────────────────────────────────────────────────
      await updatePhotosJson(filename, env.GITHUB_TOKEN);

      return corsResponse(
        JSON.stringify({ ok: true, filename }),
        200
      );

    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: 'Internal error', detail: err.message }),
        500
      );
    }
  },
};

// ─── Update photos.json in the repo ──────────────────────────────────────────
async function updatePhotosJson(newFilename, token) {
  let currentPhotos = [];
  let fileSha = null;

  // Fetch existing photos.json
  const getRes = await fetch(`${API_BASE}/photos.json`, {
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'photo-gallery-worker',
    },
  });

  if (getRes.ok) {
    const data = await getRes.json();
    fileSha = data.sha;
    try {
      const decoded = atob(data.content.replace(/\n/g, ''));
      currentPhotos = JSON.parse(decoded);
    } catch {
      currentPhotos = [];
    }
  }

  // Add new filename (no duplicates)
  if (!currentPhotos.includes(newFilename)) {
    currentPhotos.push(newFilename);
  }

  const newContent = btoa(JSON.stringify(currentPhotos, null, 2));
  const body = {
    message: `Auto-sync: update photos list`,
    content: newContent,
    branch: GITHUB_BRANCH,
  };
  if (fileSha) body.sha = fileSha;

  const putRes = await fetch(`${API_BASE}/photos.json`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'photo-gallery-worker',
    },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error('photos.json update failed: ' + (err.message || putRes.status));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateFilename(originalName) {
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  const rand = Math.random().toString(36).slice(2, 6);
  return `photo_${ts}_${rand}.${ext}`;
}

function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function corsResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret, X-Filename',
    },
  });
}
