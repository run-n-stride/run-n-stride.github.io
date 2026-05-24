// auth.js — local account system with SQL export/import, SHA-256, device sync
const Auth = {
  current: null,

  _accounts: () => JSON.parse(localStorage.getItem('rt_accounts') || '{}'),
  _saveAccounts: (a) => localStorage.setItem('rt_accounts', JSON.stringify(a)),

  // ── SHA-256 via SubtleCrypto (returns hex string, async) ──
  async _sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // ── generate a random scramble key (32 hex chars) ──
  _genScrambleKey() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // ── XOR-scramble hash with scramble key (both hex strings) ──
  _scramble(hexHash, scrambleKey) {
    let out = '';
    for (let i = 0; i < hexHash.length; i++) {
      const a = parseInt(hexHash[i], 16);
      const b = parseInt(scrambleKey[i % scrambleKey.length], 16);
      out += (a ^ b).toString(16);
    }
    return out;
  },

  async register(username, displayName, password, groqKey) {
    username = username.trim().toLowerCase();
    if (!username || username.length < 2) return { err: 'Username must be at least 2 characters.' };
    if (!/^[a-z0-9_]+$/.test(username)) return { err: 'Username: letters, numbers, underscores only.' };
    if (!password || password.length < 4) return { err: 'Password must be at least 4 characters.' };
    const accounts = this._accounts();
    if (accounts[username]) return { err: 'Username already taken.' };

    const scrambleKey = this._genScrambleKey();
    const rawHash = await this._sha256(password + username); // salted with username
    const hash = this._scramble(rawHash, scrambleKey);       // scrambled with key

    accounts[username] = {
      username,
      displayName: displayName || username,
      hash,         // scrambled SHA-256
      scrambleKey,  // needed to unscramble for verification
      createdAt: Date.now(),
      devices: [this._deviceId()],
    };
    this._saveAccounts(accounts);
    if (groqKey) localStorage.setItem(`rt_${username}_groq`, groqKey);
    return { ok: true };
  },

  async login(username, password) {
    username = username.trim().toLowerCase();
    const accounts = this._accounts();
    const acc = accounts[username];
    if (!acc) return { err: 'Account not found.' };

    const rawHash = await this._sha256(password + username);
    const scrambled = this._scramble(rawHash, acc.scrambleKey);
    if (scrambled !== acc.hash) return { err: 'Wrong password.' };

    // check if this is a new device
    const devId = this._deviceId();
    const isNewDevice = !(acc.devices || []).includes(devId);

    this.current = { ...acc };
    localStorage.setItem('rt_session', username);
    DB.init(username);

    // register this device
    if (isNewDevice) {
      accounts[username].devices = [...(acc.devices || []), devId];
      this._saveAccounts(accounts);
    }

    return { ok: true, isNewDevice, hasSyncToken: !!localStorage.getItem(`rt_${username}_sync_token`) };
  },

  // Login with imported SQL file — returns { ok, username } or { err }
  async loginWithSQL(sqlText, password) {
    const parsed = this._parseSQL(sqlText);
    if (!parsed) return { err: 'Invalid or corrupted SQL file.' };

    const { account, data } = parsed;
    const username = account.username;
    const rawHash = await this._sha256(password + username);
    const scrambled = this._scramble(rawHash, account.scrambleKey);
    if (scrambled !== account.hash) return { err: 'Wrong password — does not match the SQL file.' };

    // import account
    const accounts = this._accounts();
    accounts[username] = { ...account, devices: [...(account.devices || []), this._deviceId()] };
    this._saveAccounts(accounts);

    // import data
    DB.init(username);
    Object.entries(data).forEach(([k, v]) => DB.set(k, v));
    if (account.groqKey) localStorage.setItem(`rt_${username}_groq`, account.groqKey);

    this.current = { ...accounts[username] };
    localStorage.setItem('rt_session', username);
    return { ok: true, username };
  },

  logout() {
    this.current = null;
    localStorage.removeItem('rt_session');
  },

  async resume() {
    const u = localStorage.getItem('rt_session');
    if (!u) return false;
    const accounts = this._accounts();
    if (!accounts[u]) { localStorage.removeItem('rt_session'); return false; }
    this.current = { ...accounts[u] };
    DB.init(u);
    return true;
  },

  updateProfile(displayName) {
    const accounts = this._accounts();
    if (!accounts[this.current.username]) return;
    accounts[this.current.username].displayName = displayName;
    this._saveAccounts(accounts);
    this.current.displayName = displayName;
  },

  groqKey() {
    return localStorage.getItem(`rt_${this.current?.username}_groq`) || '';
  },

  saveGroqKey(key) {
    localStorage.setItem(`rt_${this.current.username}_groq`, key);
  },

  deleteAccount() {
    const u = this.current.username;
    const accounts = this._accounts();
    delete accounts[u];
    this._saveAccounts(accounts);
    Object.keys(localStorage)
      .filter(k => k.startsWith(`rt_${u}_`))
      .forEach(k => localStorage.removeItem(k));
    this.logout();
  },

  // ── SQL export ──
  exportSQL() {
    const u = this.current.username;
    const accounts = this._accounts();
    const acc = accounts[u];
    const groqKey = this.groqKey();

    // gather all user data keys
    const dataKeys = ['runs', 'goals', 'plans', 'profile', 'warmup'];
    const dataRows = dataKeys.map(k => {
      const val = DB.get(k, null);
      return val !== null
        ? `INSERT INTO user_data (key, value) VALUES ('${k}', '${JSON.stringify(val).replace(/'/g, "''")}');`
        : null;
    }).filter(Boolean).join('\n');

    const accountRow = JSON.stringify({
      username: acc.username,
      displayName: acc.displayName,
      hash: acc.hash,
      scrambleKey: acc.scrambleKey,
      createdAt: acc.createdAt,
      devices: acc.devices || [],
      groqKey: groqKey || '',
    }).replace(/'/g, "''");

    const sql = `-- RunTrack SQL export for user: ${u}
-- Generated: ${new Date().toISOString()}
-- Password is stored as scrambled SHA-256. Do not edit hash or scrambleKey.
-- Import this file on a new device via the login screen.

CREATE TABLE IF NOT EXISTS account (data TEXT);
CREATE TABLE IF NOT EXISTS user_data (key TEXT PRIMARY KEY, value TEXT);

DELETE FROM account;
INSERT INTO account (data) VALUES ('${accountRow}');

DELETE FROM user_data;
${dataRows}
`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sql], { type: 'text/plain' }));
    a.download = `runtrack_${u}_${new Date().toISOString().split('T')[0]}.sql`;
    a.click();
  },

  // ── SQL parser ──
  _parseSQL(text) {
    try {
      const accountMatch = text.match(/INSERT INTO account \(data\) VALUES \('([\s\S]+?)'\);/);
      if (!accountMatch) return null;
      const account = JSON.parse(accountMatch[1].replace(/''/g, "'"));

      const data = {};
      const dataRe = /INSERT INTO user_data \(key, value\) VALUES \('([^']+)', '([\s\S]+?)'\);/g;
      let m;
      while ((m = dataRe.exec(text)) !== null) {
        try { data[m[1]] = JSON.parse(m[2].replace(/''/g, "'")); } catch {}
      }
      return { account, data };
    } catch {
      return null;
    }
  },

  // ── Sync via Cloudflare Worker ──
  // Worker URL is set in sync-config.js (SYNC_WORKER_URL)
  // Token lives in the Worker's env vars — never in the browser.

  syncEnabled() {
    return typeof SYNC_WORKER_URL !== 'undefined'
      && !SYNC_WORKER_URL.includes('YOUR_WORKER');
  },

  async pushSync() {
    if (!this.syncEnabled()) return { err: 'Sync not configured — set SYNC_WORKER_URL in sync-config.js' };
    const u = this.current.username;
    const accounts = this._accounts();
    const acc = accounts[u];
    const dataKeys = ['runs', 'goals', 'plans', 'profile', 'warmup'];
    const payload = {};
    dataKeys.forEach(k => { payload[k] = DB.get(k, null); });

    const body = {
      account: {
        username: acc.username,
        displayName: acc.displayName,
        hash: acc.hash,
        scrambleKey: acc.scrambleKey,
        createdAt: acc.createdAt,
      },
      data: payload,
      syncedAt: new Date().toISOString(),
    };

    const res = await fetch(`${SYNC_WORKER_URL}/sync`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Username': u },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { err: err.error || `Worker error ${res.status}` };
    }
    localStorage.setItem(`rt_${u}_last_sync`, new Date().toISOString());
    return { ok: true };
  },

  async pullSync() {
    if (!this.syncEnabled()) return { err: 'Sync not configured.' };
    const u = this.current.username;
    const res = await fetch(`${SYNC_WORKER_URL}/sync`, {
      headers: { 'X-Username': u },
    });
    if (!res.ok) return { err: `Worker error ${res.status}` };
    const json = await res.json();
    if (!json.data) return { ok: true, empty: true };
    Object.entries(json.data).forEach(([k, v]) => { if (v !== null) DB.set(k, v); });
    localStorage.setItem(`rt_${u}_last_sync`, new Date().toISOString());
    return { ok: true };
  },

    // ── device fingerprint (stable per browser) ──
  _deviceId() {
    let id = localStorage.getItem('rt_device_id');
    if (!id) {
      const arr = new Uint8Array(8);
      crypto.getRandomValues(arr);
      id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('rt_device_id', id);
    }
    return id;
  },

  // legacy sync: fallback hash check for old accounts
  _legacyHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
    return h.toString(36);
  },
};

// ── DOM handlers ──
function switchAuth(tab) {
  document.querySelectorAll('.atab').forEach((t, i) => t.classList.toggle('active', (i === 0) === (tab === 'login')));
  document.getElementById('auth-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('auth-error').textContent = '';
}

function toggleSQLImport() {
  const zone = document.getElementById('sql-import-zone');
  zone.style.display = zone.style.display === 'none' ? '' : 'none';
}

async function doLogin() {
  const u = document.getElementById('login-user').value;
  const p = document.getElementById('login-pass').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  const r = await Auth.login(u, p);
  if (r.err) {
    // check for old legacy-hash accounts and migrate
    const accounts = Auth._accounts();
    const acc = accounts[u.trim().toLowerCase()];
    if (acc && !acc.scrambleKey && acc.hash === Auth._legacyHash(p)) {
      // migrate to new hash system
      const scrambleKey = Auth._genScrambleKey();
      const rawHash = await Auth._sha256(p + u.trim().toLowerCase());
      const hash = Auth._scramble(rawHash, scrambleKey);
      accounts[u.trim().toLowerCase()].hash = hash;
      accounts[u.trim().toLowerCase()].scrambleKey = scrambleKey;
      Auth._saveAccounts(accounts);
      await doLogin(); // retry
      return;
    }
    errEl.textContent = r.err; return;
  }
  if (r.isNewDevice && !r.hasSyncToken) {
    showSyncPrompt(u.trim().toLowerCase());
  } else {
    bootApp();
  }
}

async function doRegister() {
  const u = document.getElementById('reg-user').value;
  const d = document.getElementById('reg-display').value;
  const p = document.getElementById('reg-pass').value;
  const g = document.getElementById('reg-groq').value.trim();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  const r = await Auth.register(u, d, p, g);
  if (r.err) { errEl.textContent = r.err; return; }
  await Auth.login(u, p);
  bootApp();
}

function doLogout() {
  Auth.logout();
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('sync-prompt').style.display = 'none';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// ── SQL import handler ──
let _sqlFile = null;
function handleSQLFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { _sqlFile = ev.target.result; document.getElementById('sql-file-name').textContent = file.name; };
  reader.readAsText(file);
}

async function doSQLImport() {
  if (!_sqlFile) { document.getElementById('auth-error').textContent = 'Select a .sql file first.'; return; }
  const p = document.getElementById('login-pass').value;
  if (!p) { document.getElementById('auth-error').textContent = 'Enter your password to decrypt the file.'; return; }
  const r = await Auth.loginWithSQL(_sqlFile, p);
  document.getElementById('auth-error').textContent = r.err || '';
  if (r.ok) bootApp();
}

// ── sync prompt (new device detected) ──
function showSyncPrompt(username) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('sync-prompt').style.display = 'flex';
  document.getElementById('sync-username-label').textContent = username;
}

// ── sync prompt — just one button, no tokens/IDs needed from user ──
async function doSyncPull() {
  const errEl = document.getElementById('sync-error');
  errEl.textContent = '';
  if (!Auth.syncEnabled()) {
    errEl.textContent = 'Sync not configured — edit sync-config.js in the repo first.';
    return;
  }
  const btn = document.getElementById('btn-sync-pull');
  btn.disabled = true; btn.textContent = 'Syncing…';
  const r = await Auth.pullSync();
  btn.disabled = false; btn.textContent = 'Pull my data';
  if (r.err) { errEl.textContent = r.err; return; }
  document.getElementById('sync-prompt').style.display = 'none';
  bootApp();
}

function dismissSyncPrompt() {
  document.getElementById('sync-prompt').style.display = 'none';
  bootApp();
}

// ── background sync on page open ──
async function checkBackgroundSync() {
  if (!Auth.current || !Auth.syncEnabled()) return;
  const u = Auth.current.username;
  const lastSync = localStorage.getItem(`rt_${u}_last_sync`);
  if (lastSync && (Date.now() - new Date(lastSync).getTime()) < 10 * 60 * 1000) return;
  try { await Auth.pullSync(); } catch {}
}

// ── auto-push 5s after a run is saved ──
let _syncPushTimer = null;
function scheduleSyncPush() {
  if (!Auth.syncEnabled()) return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(async () => {
    try { await Auth.pushSync(); } catch {}
  }, 5000);
}
