// live.js — GPS live run tracking with background support + Service Worker
const Live = {
  _running: false,
  _watchId: null,
  _startTime: null,
  _timerInterval: null,
  _points: [],           // [[lat,lng,timestamp], ...]
  _lastPos: null,
  _totalDist: 0,
  _mapReady: false,
  _paceBuffer: [],       // rolling window for smoothed pace

  init() {
    if (!this._mapReady) {
      Maps.init('map-live', 'live', { zoom: 15 });
      this._mapReady = true;
    }
    Maps.invalidate('live');
    // restore an in-progress run if page was reloaded / came back to foreground
    this._restoreIfRunning();
  },

  // ── persist run state so it survives tab switches / screen off ──
  _persist() {
    if (!this._running) return;
    localStorage.setItem('rt_live_run', JSON.stringify({
      startTime: this._startTime,
      points: this._points,
      totalDist: this._totalDist,
    }));
  },

  _clearPersisted() {
    localStorage.removeItem('rt_live_run');
  },

  _restoreIfRunning() {
    const saved = localStorage.getItem('rt_live_run');
    if (!saved) return;
    try {
      const s = JSON.parse(saved);
      // only restore if < 8 hours old
      if (Date.now() - s.startTime > 8 * 3600 * 1000) { this._clearPersisted(); return; }
      this._startTime = s.startTime;
      this._points = s.points || [];
      this._totalDist = s.totalDist || 0;
      this._running = true;
      this._lastPos = this._points.length
        ? { lat: this._points.at(-1)[0], lng: this._points.at(-1)[1], t: this._points.at(-1)[2] }
        : null;

      // rebuild map
      this._points.forEach(([lat, lng]) => Maps.addLivePoint('live', { lat, lng }));

      document.getElementById('btn-start-live').style.display = 'none';
      document.getElementById('btn-stop-live').style.display = '';
      document.getElementById('btn-discard-live').style.display = '';
      document.getElementById('live-status').className = 'live-status live-running';
      document.getElementById('live-status-text').textContent = '● Resumed...';
      document.getElementById('live-dist').textContent = this._totalDist.toFixed(2);

      this._watchId = navigator.geolocation.watchPosition(
        pos => this._onPos(pos), err => this._onErr(err),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
      this._timerInterval = setInterval(() => this._updateTimer(), 1000);
    } catch { this._clearPersisted(); }
  },

  start() {
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    this._points = [];
    this._totalDist = 0;
    this._lastPos = null;
    this._paceBuffer = [];
    Maps.points['live'] = [];
    Maps.clear('live');

    this._running = true;
    this._startTime = Date.now();

    document.getElementById('btn-start-live').style.display = 'none';
    document.getElementById('btn-stop-live').style.display = '';
    document.getElementById('btn-discard-live').style.display = '';
    document.getElementById('live-status').className = 'live-status live-running';
    document.getElementById('live-status-text').textContent = '● Recording...';

    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onPos(pos), err => this._onErr(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    this._timerInterval = setInterval(() => this._updateTimer(), 1000);
  },

  _onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (accuracy > 80) return;

    const now = Date.now();
    const pt = { lat, lng, t: now };

    if (this._lastPos) {
      const d = this._haversine(this._lastPos.lat, this._lastPos.lng, lat, lng);
      if (d < 0.003) return; // filter sub-3m jitter

      // gap detection — if > 45s since last point (screen was off), store gap marker
      // instead of counting the distance, so the line isn't drawn wrong
      const gapSec = (now - this._lastPos.t) / 1000;
      if (gapSec > 45) {
        // insert a gap marker so the polyline skips this segment
        this._points.push(null);  // null = gap, renderer skips
        Maps.addGap('live');
      } else {
        this._totalDist += d;
        document.getElementById('live-dist').textContent = this._totalDist.toFixed(2);

        // smoothed pace — EMA over last 8 samples
        const dt = gapSec;
        if (dt > 0 && d > 0) {
          const rawPace = dt / d;
          // only count plausible paces (1:30–20:00 /km)
          if (rawPace > 90 && rawPace < 1200) {
            this._paceBuffer.push(rawPace);
            if (this._paceBuffer.length > 8) this._paceBuffer.shift();
            const smoothed = this._paceBuffer.reduce((a, v) => a + v, 0) / this._paceBuffer.length;
            document.getElementById('live-pace').textContent = Runs.fmtPace(smoothed);
          }
        }
      }
    }

    this._lastPos = pt;
    this._points.push([lat, lng, now]);
    Maps.addLivePoint('live', { lat, lng });
    this._persist();
  },

  _onErr(err) {
    const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'GPS timeout — will retry.' };
    document.getElementById('live-status-text').textContent = msgs[err.code] || 'GPS error.';
  },

  _updateTimer() {
    if (!this._startTime) return;
    const secs = Math.floor((Date.now() - this._startTime) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    document.getElementById('live-time').textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  },

  stop() {
    if (!this._running) return;
    navigator.geolocation.clearWatch(this._watchId);
    clearInterval(this._timerInterval);
    this._running = false;
    this._clearPersisted();

    const timeSec = Math.floor((Date.now() - this._startTime) / 1000);
    const dist = this._totalDist;

    document.getElementById('live-status').className = 'live-status live-done';
    document.getElementById('live-status-text').textContent = 'Run complete!';
    document.getElementById('btn-stop-live').style.display = 'none';
    document.getElementById('btn-discard-live').style.display = 'none';
    document.getElementById('btn-start-live').style.display = '';

    if (dist < 0.05) { alert('Too short to save (< 50m).'); this._reset(); return; }

    // strip null gap markers for the saved route
    const cleanRoute = this._points.filter(p => p !== null).map(p => [p[0], p[1]]);

    const run = {
      id: Date.now(),
      userId: Auth.current.username,
      displayName: Auth.current.displayName,
      date: new Date().toISOString().split('T')[0],
      name: `Live run ${new Date().toLocaleDateString()}`,
      dist, timeSec,
      elev: 0,
      pace: Runs.calcPace(dist, timeSec),
      notes: 'Recorded live via GPS',
      tags: ['Live'],
      route: cleanRoute,
      verified: false,
      stravaImg: null,
    };

    Runs.add(run);
    scheduleSyncPush();
    this._reset();

    // ask about route + strava after save
    showRoutePrompt(run);
  },

  discard() {
    if (!confirm('Discard this run?')) return;
    navigator.geolocation.clearWatch(this._watchId);
    clearInterval(this._timerInterval);
    this._running = false;
    this._clearPersisted();
    this._reset();
  },

  _reset() {
    document.getElementById('live-dist').textContent = '0.00';
    document.getElementById('live-pace').textContent = '—';
    document.getElementById('live-time').textContent = '00:00';
    document.getElementById('live-status').className = 'live-status live-idle';
    document.getElementById('live-status-text').textContent = 'Ready to run';
    document.getElementById('btn-start-live').style.display = '';
    document.getElementById('btn-stop-live').style.display = 'none';
    document.getElementById('btn-discard-live').style.display = 'none';
  },

  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
};

function startLiveRun() { Live.start(); }
function stopLiveRun() { Live.stop(); }
function discardLiveRun() { Live.discard(); }
