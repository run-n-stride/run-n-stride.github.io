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

## AI Coach setup

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Open the app → Settings → paste your Groq key
3. Key is stored only on your device (`localStorage`), never sent anywhere except Groq's API

## Notes

- **All data is stored in your browser's `localStorage`** — it persists across sessions on the same browser/device
- The global leaderboard works by storing the data in github. You have to opt-in for this to happen
- Using the SQL export, you can login and sync data on multiple devices
- Verified runs require uploading a Strava screenshot as proof (image is stored as base64 in localStorage)
- Live GPS tracking requires location permission and works best on mobile
