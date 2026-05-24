// maps.js — Leaflet map instances
const Maps = {
  _maps: {},
  _lines: {},
  _lineSegments: {},  // for gap-aware live drawing
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
    this._lineSegments[key] = [[]]; // array of segments; each segment is an array of [lat,lng]

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
    this._lineSegments[key] = [[]];
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

  // draw a saved route (array of [lat,lng] or [[lat,lng],...] with nulls stripped)
  showRoute(containerId, key, route, opts = {}) {
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

  // live tracking — add a normal point
  addLivePoint(key, latlng) {
    if (!this._maps[key]) return;
    const pt = [latlng.lat, latlng.lng];
    this.points[key] = this.points[key] || [];
    this.points[key].push(pt);

    // add to current segment
    if (!this._lineSegments[key]) this._lineSegments[key] = [[]];
    this._lineSegments[key].at(-1).push(pt);
    this._redrawLiveLines(key);
    this._maps[key].setView(latlng, this._maps[key].getZoom());
  },

  // live tracking — mark a gap (screen was off, don't draw line across gap)
  addGap(key) {
    if (!this._lineSegments[key]) this._lineSegments[key] = [[]];
    // only start a new segment if current one has points
    if (this._lineSegments[key].at(-1).length > 0) {
      this._lineSegments[key].push([]);
    }
  },

  _redrawLiveLines(key) {
    const map = this._maps[key];
    if (!map) return;
    // remove old segment polylines
    (this._markers[key + '_segs'] || []).forEach(l => map.removeLayer(l));
    const segs = [];
    (this._lineSegments[key] || []).forEach(seg => {
      if (seg.length > 1) {
        segs.push(L.polyline(seg, { color: '#c8ff00', weight: 3, opacity: 0.9 }).addTo(map));
      }
    });
    this._markers[key + '_segs'] = segs;
  },

  get(key) { return this._maps[key]; },
  getPoints(key) { return this.points[key] || []; },
  invalidate(key) { this._maps[key]?.invalidateSize(); }
};

function clearMap(key) { Maps.clear(key); }
function undoLast(key) { Maps.undo(key); }
