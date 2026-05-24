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

  // ── Sync via GitHub Gist ──
  saveSyncToken(token) {
    localStorage.setItem(`rt_${this.current.username}_sync_token`, token);
  },
  getSyncToken() {
    return localStorage.getItem(`rt_${this.current?.username}_sync_token`) || '';
  },

  async pushSync() {
    const token = this.getSyncToken();
    if (!token) return { err: 'No GitHub token saved.' };
    const u = this.current.username;
    const accounts = this._accounts();
    const acc = accounts[u];
    const dataKeys = ['runs', 'goals', 'plans', 'profile', 'warmup'];
    const payload = {};
    dataKeys.forEach(k => { payload[k] = DB.get(k, null); });

    const gistId = localStorage.getItem(`rt_${u}_gist_id`);
    const method = gistId ? 'PATCH' : 'POST';
    const url = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';

    const body = {
      description: `RunTrack sync — ${u}`,
      public: false,
      files: {
        [`runtrack_${u}.json`]: {
          content: JSON.stringify({ account: { username: acc.username, displayName: acc.displayName, hash: acc.hash, scrambleKey: acc.scrambleKey, createdAt: acc.createdAt }, data: payload }, null, 2)
        }
      }
    };

    const res = await fetch(url, {
      method,
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { err: `GitHub error ${res.status}` };
    const json = await res.json();
    localStorage.setItem(`rt_${u}_gist_id`, json.id);
    localStorage.setItem(`rt_${u}_last_sync`, new Date().toISOString());
    return { ok: true, gistId: json.id };
  },

  async pullSync(gistId, token) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `token ${token}` }
    });
    if (!res.ok) return { err: `GitHub error ${res.status}` };
    const json = await res.json();
    const file = Object.values(json.files)[0];
    if (!file) return { err: 'No data in Gist.' };
    const raw = await fetch(file.raw_url).then(r => r.json());
    const { data } = raw;
    Object.entries(data).forEach(([k, v]) => { if (v !== null) DB.set(k, v); });
    localStorage.setItem(`rt_${this.current.username}_last_sync`, new Date().toISOString());
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

function dismissSyncPrompt() {
  document.getElementById('sync-prompt').style.display = 'none';
  bootApp();
}

async function doSyncPull() {
  const gistId = document.getElementById('sync-gist-id').value.trim();
  const token = document.getElementById('sync-gh-token').value.trim();
  const errEl = document.getElementById('sync-error');
  errEl.textContent = '';
  if (!gistId || !token) { errEl.textContent = 'Enter both Gist ID and GitHub token.'; return; }
  Auth.saveSyncToken(token);
  localStorage.setItem(`rt_${Auth.current.username}_gist_id`, gistId);
  const r = await Auth.pullSync(gistId, token);
  if (r.err) { errEl.textContent = r.err; return; }
  document.getElementById('sync-prompt').style.display = 'none';
  bootApp();
}

// ── background sync check on page load ──
async function checkBackgroundSync() {
  const u = Auth.current?.username;
  if (!u) return;
  const token = Auth.getSyncToken();
  const gistId = localStorage.getItem(`rt_${u}_gist_id`);
  if (!token || !gistId) return;
  const lastSync = localStorage.getItem(`rt_${u}_last_sync`);
  // only auto-pull if last sync was > 10 minutes ago
  if (lastSync && (Date.now() - new Date(lastSync).getTime()) < 10 * 60 * 1000) return;
  try { await Auth.pullSync(gistId, token); } catch {}
}
