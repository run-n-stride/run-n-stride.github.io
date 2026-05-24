# RunTrack — Setup Guide

## 1. Create a GitHub fine-grained token

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Name it `runtrack-sync`
4. Under **Repository access** → select **Only select repositories** → pick this repo
5. Under **Permissions** → **Contents** → set to **Read and write**
6. Click Generate — copy the token (`github_pat_...`)

---

## 2. Deploy the Cloudflare Worker

1. Go to https://workers.cloudflare.com → sign up free (no credit card)
2. Click **Create Worker**
3. Delete the placeholder code, paste the entire contents of `worker.js`
4. Click **Save and deploy**
5. Copy your Worker URL — looks like `https://runtrack-sync.yourname.workers.dev`

### Add secrets (so the token never touches the browser)

In your Worker page → **Settings** → **Variables** → **Add variable** for each:

| Name | Value |
|------|-------|
| `GITHUB_TOKEN` | your `github_pat_...` token |
| `GITHUB_OWNER` | your GitHub username |
| `GITHUB_REPO` | your repo name |
| `ALLOWED_ORIGIN` | your GitHub Pages URL e.g. `https://yourname.github.io` |

Click **Encrypt** on `GITHUB_TOKEN` so it's stored as a secret.

---

## 3. Configure the app

Open `sync-config.js` and replace the placeholder:

```js
const SYNC_WORKER_URL = 'https://runtrack-sync.yourname.workers.dev';
```

Commit and push. Done.

---

## How it works

- Each user's data is stored at `sync/{username}.json` in your repo
- The Worker is the only thing that holds your GitHub token — the browser never sees it
- Syncs automatically 5 seconds after a run is saved, and on app open if >10 min since last sync
- On a new device, logging in shows a prompt to pull existing data
- Free tier: 100,000 Worker requests/day (~30,000 daily active users)
