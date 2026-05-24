// live.js — GPS live run tracking
const Live = {
  _running: false,
  _watchId: null,
  _startTime: null,
  _timerInterval: null,
  _points: [],
  _lastPos: null,
  _totalDist: 0,
  _mapReady: false,

  init() {
    if (!this._mapReady) {
      Maps.init('map-live', 'live', { zoom: 15 });
      this._mapReady = true;
    }
    Maps.invalidate('live');
  },

  start() {
    if (!navigator.geolocation) { alert('Geolocation not supported by your browser.'); return; }
    this._points = [];
    this._totalDist = 0;
    this._lastPos = null;
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
      pos => this._onPos(pos),
      err => this._onErr(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    this._timerInterval = setInterval(() => this._updateTimer(), 1000);
  },

  _onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    // ignore low accuracy points
    if (accuracy > 80) return;

    const pt = { lat, lng, t: Date.now() };
    if (this._lastPos) {
      const d = this._haversine(this._lastPos.lat, this._lastPos.lng, lat, lng);
      if (d < 0.003) return; // filter out < 3m jitter
      this._totalDist += d;
      document.getElementById('live-dist').textContent = this._totalDist.toFixed(2);

      // current pace: distance since last point / time since last point
      const dt = (pt.t - this._lastPos.t) / 1000;
      if (dt > 0 && d > 0) {
        const paceNow = (dt / d);
        document.getElementById('live-pace').textContent = Runs.fmtPace(paceNow);
      }
    }
    this._lastPos = pt;
    this._points.push([lat, lng]);
    Maps.addLivePoint('live', { lat, lng });
  },

  _onErr(err) {
    const msgs = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'GPS timeout.' };
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

    const timeSec = Math.floor((Date.now() - this._startTime) / 1000);
    const dist = this._totalDist;

    document.getElementById('live-status').className = 'live-status live-done';
    document.getElementById('live-status-text').textContent = 'Run complete!';
    document.getElementById('btn-stop-live').style.display = 'none';
    document.getElementById('btn-discard-live').style.display = 'none';
    document.getElementById('btn-start-live').style.display = '';

    if (dist < 0.05) { alert('Too short to save (< 50m).'); this._reset(); return; }

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
      route: this._points,
      verified: false,
      stravaImg: null,
    };
    Runs.add(run);
    this._reset();
    showPage('history');
  },

  discard() {
    if (!confirm('Discard this run?')) return;
    navigator.geolocation.clearWatch(this._watchId);
    clearInterval(this._timerInterval);
    this._running = false;
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
