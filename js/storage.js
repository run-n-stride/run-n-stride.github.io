// storage.js — namespaced localStorage per user
const DB = {
  _u: '',
  _k: k => `rt_${DB._u}_${k}`,
  init(username) { DB._u = username; },
  get: (k, def = null) => { try { const v = localStorage.getItem(DB._k(k)); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(DB._k(k), JSON.stringify(v)); } catch(e) { console.warn('Storage full', e); } },
  del: (k) => localStorage.removeItem(DB._k(k)),
  // global (shared across users, stored in shared namespace)
  gget: (k, def = null) => { try { const v = localStorage.getItem(`rt_global_${k}`); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  gset: (k, v) => { try { localStorage.setItem(`rt_global_${k}`, JSON.stringify(v)); } catch { } },
};

// global Worker URL helper — used by runs.js, leaderboard.js, ui.js
const _wurl = () => (typeof SYNC_WORKER_URL !== 'undefined' ? SYNC_WORKER_URL : '').replace(/\/+$/, '');
