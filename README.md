# RunTrack

A local-first community running tracker. Works on GitHub Pages — no server, no database, everything stays on your device.

## Features

- **Accounts** — create a local account (stored only in your browser)
- **Log runs** — distance, time, elevation, feel tags, notes, Strava screenshot upload
- **Live GPS tracking** — track a run in real-time from your phone
- **Draw routes** — click on the map to trace your route
- **AI Coach** — powered by Groq (free key required), gives personalized tips, pace strategies, warmup routines, weekly plans
- **Pace estimator** — predicts your time and pace for a planned run based on history
- **Segment strategy** — color-coded pace instructions per km segment
- **Leaderboard** — personal bests, global rankings (shared via localStorage on same device/browser), verified runs (with Strava proof image)

## Deploy to GitHub Pages

1. Fork or clone this repo
2. Go to **Settings → Pages**
3. Set source to **main branch / root**
4. Your app will be live at `https://yourusername.github.io/runtracker`

That's it. No build step, no npm, no config.

## AI Coach setup

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Open the app → Settings → paste your Groq key
3. Key is stored only on your device (`localStorage`), never sent anywhere except Groq's API

## Notes

- **All data is stored in your browser's `localStorage`** — it persists across sessions on the same browser/device
- The global leaderboard works across accounts on the **same device/browser** — it's shared via a common `localStorage` key
- For a true multi-device global leaderboard you'd need a backend (Supabase, Firebase, etc.)
- Verified runs require uploading a Strava screenshot as proof (image is stored as base64 in localStorage)
- Live GPS tracking requires location permission and works best on mobile

## File structure

```
index.html          — main app shell
css/app.css         — all styles
js/storage.js       — localStorage wrapper with user namespacing
js/auth.js          — local account system (register/login/logout)
js/maps.js          — Leaflet map management
js/runs.js          — run CRUD, pace math, plan engine
js/coach.js         — Groq AI coach
js/leaderboard.js   — personal bests + global board + verified runs
js/live.js          — GPS live tracking
js/app.js           — bootstrap + page router
```
