// RunTrack Service Worker
const CACHE = 'runtrack-v3';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/storage.js',
  '/js/auth.js',
  '/js/maps.js',
  '/js/runs.js',
  '/js/coach.js',
  '/js/leaderboard.js',
  '/js/live.js',
  '/js/ui.js',
  '/js/app.js',
  '/sync-config.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// fetch — network first, fall back to cache
self.addEventListener('fetch', e => {
  // never intercept sync worker or groq calls
  if (e.request.url.includes('workers.dev') ||
      e.request.url.includes('groq.com') ||
      e.request.url.includes('api.github.com') ||
      e.request.url.includes('tile.openstreetmap')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // cache successful GET responses
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
