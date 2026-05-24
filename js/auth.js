// auth.js — local account system, no server needed
const Auth = {
  current: null,

  _accounts: () => JSON.parse(localStorage.getItem('rt_accounts') || '{}'),
  _saveAccounts: (a) => localStorage.setItem('rt_accounts', JSON.stringify(a)),

  register(username, displayName, password, groqKey) {
    username = username.trim().toLowerCase();
    if (!username || username.length < 2) return { err: 'Username must be at least 2 characters.' };
    if (!/^[a-z0-9_]+$/.test(username)) return { err: 'Username: letters, numbers, underscores only.' };
    if (!password || password.length < 4) return { err: 'Password must be at least 4 characters.' };
    const accounts = this._accounts();
    if (accounts[username]) return { err: 'Username already taken.' };
    // simple hash (not crypto-secure but fine for local storage)
    const hash = this._hash(password);
    accounts[username] = { username, displayName: displayName || username, hash, createdAt: Date.now() };
    this._saveAccounts(accounts);
    // store groq key separately under user namespace
    if (groqKey) localStorage.setItem(`rt_${username}_groq`, groqKey);
    return { ok: true };
  },

  login(username, password) {
    username = username.trim().toLowerCase();
    const accounts = this._accounts();
    const acc = accounts[username];
    if (!acc) return { err: 'Account not found.' };
    if (acc.hash !== this._hash(password)) return { err: 'Wrong password.' };
    this.current = { ...acc };
    localStorage.setItem('rt_session', username);
    DB.init(username);
    return { ok: true };
  },

  logout() {
    this.current = null;
    localStorage.removeItem('rt_session');
  },

  resume() {
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
    // wipe all user data
    Object.keys(localStorage)
      .filter(k => k.startsWith(`rt_${u}_`))
      .forEach(k => localStorage.removeItem(k));
    this.logout();
  },

  _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
    return h.toString(36);
  }
};

// ── DOM handlers ──
function switchAuth(tab) {
  document.querySelectorAll('.atab').forEach((t, i) => t.classList.toggle('active', (i === 0) === (tab === 'login')));
  document.getElementById('auth-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? '' : 'none';
  document.getElementById('auth-error').textContent = '';
}

function doLogin() {
  const u = document.getElementById('login-user').value;
  const p = document.getElementById('login-pass').value;
  const r = Auth.login(u, p);
  if (r.err) { document.getElementById('auth-error').textContent = r.err; return; }
  bootApp();
}

function doRegister() {
  const u = document.getElementById('reg-user').value;
  const d = document.getElementById('reg-display').value;
  const p = document.getElementById('reg-pass').value;
  const g = document.getElementById('reg-groq').value.trim();
  const r = Auth.register(u, d, p, g);
  if (r.err) { document.getElementById('auth-error').textContent = r.err; return; }
  Auth.login(u, p);
  bootApp();
}

function doLogout() {
  Auth.logout();
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}
