// maps.js — Leaflet map instances
const Maps = {
  _maps: {},
  _lines: {},
  _markers: {},
  points: {},

  init(id, key, opts = {}) {
    if (this._maps[key]) { setTimeout(() => this._maps[key].invalidateSize(), 100); return; }
    const map = L.map(id, { center: opts.center || [49.6116, 6.1319], zoom: opts.zoom || 13 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 19
    }).addTo(map);
    this._maps[key] = map;
    this.points[key] = [];
    this._markers[key] = [];
    this._lines[key] = L.polyline([], { color: '#c8ff00', weight: 3, opacity: .9 }).addTo(map);

    if (!opts.readonly) {
      map.on('click', e => {
        const pt = [e.latlng.lat, e.latlng.lng];
        this.points[key].push(pt);
        const mk = L.circleMarker(e.latlng, {
          radius: this.points[key].length === 1 ? 6 : 4,
          fillColor: this.points[key].length === 1 ? '#60a5fa' : '#c8ff00',
          color: '#0a0a0a', weight: 1, fillOpacity: 1
        }).addTo(map);
        this._markers[key].push(mk);
        this._lines[key].setLatLngs(this.points[key]);
      });
    }
    setTimeout(() => map.invalidateSize(), 150);
  },

  clear(key) {
    this.points[key] = [];
    (this._markers[key] || []).forEach(m => this._maps[key]?.removeLayer(m));
    this._markers[key] = [];
    this._lines[key]?.setLatLngs([]);
  },

  undo(key) {
    if (!this.points[key]?.length) return;
    this.points[key].pop();
    const m = this._markers[key]?.pop();
    if (m) this._maps[key]?.removeLayer(m);
    this._lines[key]?.setLatLngs(this.points[key]);
  },

  // draw a saved route on an existing or new map
  showRoute(containerId, key, route, opts = {}) {
    // remove old map if recycling
    if (this._maps[key]) { this._maps[key].remove(); delete this._maps[key]; }
    this.init(containerId, key, { ...opts, readonly: true });
    const map = this._maps[key];
    if (!route || !route.length) return;
    const line = L.polyline(route, { color: '#c8ff00', weight: 3 }).addTo(map);
    L.circleMarker(route[0], { radius: 6, fillColor: '#60a5fa', color: '#0a0a0a', weight: 1, fillOpacity: 1 }).addTo(map);
    if (route.length > 1) {
      L.circleMarker(route[route.length - 1], { radius: 6, fillColor: '#f87171', color: '#0a0a0a', weight: 1, fillOpacity: 1 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
    } else {
      map.setView(route[0], 15);
    }
  },

  // for live tracking — just add a point, don't create click handlers
  addLivePoint(key, latlng) {
    if (!this._maps[key]) return;
    const pt = [latlng.lat, latlng.lng];
    this.points[key] = this.points[key] || [];
    this.points[key].push(pt);
    this._lines[key].setLatLngs(this.points[key]);
    this._maps[key].setView(latlng, this._maps[key].getZoom());
  },

  get(key) { return this._maps[key]; },
  getPoints(key) { return this.points[key] || []; },
  invalidate(key) { this._maps[key]?.invalidateSize(); }
};

function clearMap(key) { Maps.clear(key); }
function undoLast(key) { Maps.undo(key); }
