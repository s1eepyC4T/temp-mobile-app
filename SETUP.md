# Photo Gallery — Full Setup Guide

## Architecture

```
iPhone Camera Roll
       |
       | (iOS Automation Shortcut — fires on every new photo)
       v
Cloudflare Worker   <-- free, handles Base64 encoding
(photo-gallery-worker.USERNAME.workers.dev/upload)
       |
       | (GitHub API PUT)
       v
GitHub Repo (s1eepyc4t/temp-mobile-app)
  /photos/photo_xxx.jpg
  /photos.json  ["photo_xxx.jpg", ...]
       |
       | (GitHub Pages)
       v
PWA at https://s1eepyc4t.github.io/temp-mobile-app/
  (auto-polls every 30s for new photos)
```

---

## PART 1 — Deploy the PWA to GitHub Pages

### 1a. Create the GitHub repo

1. Go to https://github.com/new
2. Name: `temp-mobile-app`
3. Visibility: **Public**
4. Do NOT initialize with README
5. Click **Create repository**

### 1b. Push the code

```bash
cd "/Users/svannathong/mobile app"
git remote add origin https://github.com/s1eepyc4t/temp-mobile-app.git
git push -u origin main
```

### 1c. Enable GitHub Pages

1. Go to https://github.com/s1eepyc4t/temp-mobile-app/settings/pages
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Save
5. Wait ~60 seconds → live at: `https://s1eepyc4t.github.io/temp-mobile-app/`

### 1d. Create a GitHub PAT (for the PWA's manual upload button)

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Name: `photo-gallery-pwa`
4. Repository access: only `temp-mobile-app`
5. Permissions → **Contents**: Read and write
6. Generate and copy the token (starts with `github_pat_...`)

---

## PART 2 — Deploy the Cloudflare Worker (auto-sync relay)

### 2a. Create a free Cloudflare account

Go to https://dash.cloudflare.com/sign-up — free, no credit card needed.

### 2b. Deploy the worker

Option A — Using the Cloudflare Dashboard (easiest, no install needed):

1. Go to https://dash.cloudflare.com/
2. Left menu → **Workers & Pages** → **Create**
3. Click **Create Worker**
4. Name it: `photo-gallery-worker`
5. Click **Deploy**
6. Then click **Edit code**
7. Delete everything in the editor
8. Paste the contents of `worker/worker.js` (from this project folder)
9. Click **Save and Deploy**

Option B — Using Wrangler CLI:

```bash
npm install -g wrangler
cd "/Users/svannathong/mobile app/worker"
wrangler login
wrangler deploy
```

### 2c. Set environment variables (SECRETS)

1. Go to your worker in the Cloudflare Dashboard
2. **Settings** → **Variables** → **Environment Variables**
3. Add these two variables (click "Encrypt" for both):

| Variable name  | Value |
|----------------|-------|
| `GITHUB_TOKEN` | Your GitHub PAT from step 1d |
| `UPLOAD_SECRET` | A secret password YOU choose (e.g. `mySecretKey123`) — copy it, you'll need it for the Shortcut |

4. Click **Save and Deploy**

### 2d. Note your Worker URL

It will be:
`https://photo-gallery-worker.YOUR-SUBDOMAIN.workers.dev/upload`

Find it in the Worker dashboard under the worker name. Copy this URL.

---

## PART 3 — Set Up iOS Shortcut for Auto-Sync

This is the automation that fires every time a new photo is added to your Camera Roll — even when the PWA is closed.

### 3a. Create the Shortcut action

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Name it: `Auto Sync Photo`
4. Add these actions in order:

**Action 1: Receive input**
- Search for: "Receive"
- Choose: **Receive Input from Share Sheet / Quick Actions**
- Input type: **Images**

**Action 2: Get variable**
- The input image will be passed automatically

**Action 3: Get Contents of URL**
- URL: `https://photo-gallery-worker.YOUR-SUBDOMAIN.workers.dev/upload`
- Method: **POST**
- Headers:
  - `X-Upload-Secret` → `mySecretKey123` (your UPLOAD_SECRET from step 2c)
  - `X-Filename` → `photo_SHORTCUT.jpg`
- Request Body: **File**
  - File: **Shortcut Input** (the image)

5. Tap **Done**

### 3b. Create the Automation (fires automatically)

1. In Shortcuts app, tap **Automation** tab (bottom)
2. Tap **+** → **Create Personal Automation**
3. Scroll down → tap **Photo Library**
4. Check: **New Photo Added to Library**
5. Tap **Next**
6. Tap **Add Action** → search **Run Shortcut**
7. Select: **Auto Sync Photo**
8. Turn OFF "Ask Before Running"
9. Tap **Done**

That's it. Now every time a new photo is added to your Camera Roll, the Shortcut runs automatically, uploads the photo to GitHub via the Cloudflare Worker, and your PWA gallery will show it within 30 seconds.

---

## PART 4 — Install the PWA on iPhone

1. Open **Safari** on iPhone
2. Go to: `https://s1eepyc4t.github.io/temp-mobile-app/`
3. Tap the **Share** button (box with up arrow)
4. Scroll down → tap **Add to Home Screen**
5. Tap **Add**
6. Open the app from your Home Screen
7. On first launch, paste your GitHub PAT from step 1d → tap **Connect**

---

## How It All Works Together

| Action | What happens |
|--------|-------------|
| Take a photo on iPhone | iOS Shortcut fires → uploads to GitHub via Worker |
| Open the PWA | Gallery loads all photos from GitHub |
| PWA is open | Auto-refreshes every 30 seconds, shows new photos instantly |
| Switch back to the PWA | Checks for new photos immediately |
| Tap + in the PWA | Manual upload from Camera Roll (backup method) |
| No internet | PWA shows cached photos (Service Worker) |

---

## Troubleshooting

**Shortcut not running automatically?**
- Settings → Privacy → Automation → allow Shortcuts to run without asking

**Worker returns 401?**
- Check `UPLOAD_SECRET` matches exactly between Worker env vars and the Shortcut header

**Photos not appearing in gallery?**
- Pull down to refresh in the PWA
- Check `photos.json` in the GitHub repo — it should list uploaded filenames

**Worker returns 502?**
- Check `GITHUB_TOKEN` is set correctly and has Contents write permission on `temp-mobile-app`
