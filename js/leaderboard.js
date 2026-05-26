// leaderboard.js — all data lives on GitHub via Worker, not localStorage

const Leaderboard = {

  _lbEnabled() { return DB.get('lb_share', false) === true; },

  // ── publish a run to global leaderboard on GitHub ──
  async publishRun(run) {
    if (!this._lbEnabled() || !Auth.syncEnabled()) return;
    const entry = {
      id: run.id, userId: Auth.current.username, displayName: Auth.current.displayName,
      date: run.date, name: run.name, dist: run.dist, timeSec: run.timeSec,
      pace: run.pace, elev: run.elev || 0, tags: run.tags || [],
      verified: run.verified || false, stravaImg: run.stravaImg || null,
      isPublic: run.isPublic !== false,
    };
    try {
      await fetch(`${_wurl()}/leaderboard`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch(e) { console.warn('[lb] publish failed', e.message); }
  },

  async removeRun(id) {
    if (!Auth.syncEnabled()) return;
    try {
      await fetch(`${SYNC_WORKER_URL}/leaderboard?userId=${Auth.current.username}&id=${id}`, { method: 'DELETE' });
    } catch {}
  },

  setSharing(enabled) {
    DB.set('lb_share', enabled);
    if (enabled) Runs.all().forEach(r => this.publishRun(r));
    else this._removeAllMine();
  },

  async _removeAllMine() {
    if (!Auth.syncEnabled()) return;
    const runs = Runs.all();
    for (const r of runs) await this.removeRun(r.id);
  },

  // ── MY STATS ──
  renderLocal() {
    const runs = Runs.all();
    const el   = document.getElementById('lb-local');
    if (!runs.length) { el.innerHTML = '<div class="lb-empty">No runs yet.</div>'; return; }

    const totalKm = runs.reduce((a, r) => a + r.dist, 0);
    const bestPace = Math.min(...runs.map(r => r.pace));
    const longest  = Math.max(...runs.map(r => r.dist));
    const sharing  = this._lbEnabled();
    const pbs      = this._personalBests(runs);

    el.innerHTML = `
      <div class="grid-4" style="margin-bottom:16px">
        <div class="stat-card"><div class="val">${runs.length}</div><div class="lbl">Runs</div></div>
        <div class="stat-card"><div class="val">${totalKm.toFixed(0)}</div><div class="lbl">Total km</div></div>
        <div class="stat-card"><div class="val">${Runs.fmtPace(Math.round(bestPace))}</div><div class="lbl">Best pace</div></div>
        <div class="stat-card"><div class="val">${longest.toFixed(1)}</div><div class="lbl">Longest km</div></div>
      </div>
      <div class="section">
        <h3>Personal bests</h3>
        ${pbs.map(pb => `
          <div class="goal-item">
            <div><div style="font-size:13px;font-weight:700">${pb.label}</div>
            <div style="font-size:11px;color:var(--muted2)">${pb.date}</div></div>
            <div style="font-family:'DM Mono',monospace;font-size:14px;color:var(--accent)">${pb.val}</div>
          </div>`).join('')}
      </div>
      <div class="section">
        <h3>Monthly breakdown</h3>
        ${this._monthlyBreakdown(runs)}
      </div>`;
  },

  // ── GLOBAL (from GitHub) ──
  async renderGlobal() {
    const el = document.getElementById('lb-global');
    el.innerHTML = '<div class="lb-empty">Loading…</div>';
    let entries = [];
    try {
      const r = await fetch(`${_wurl()}/leaderboard`);
      if (r.ok) entries = await r.json();
    } catch { el.innerHTML = '<div class="lb-empty">Could not load — check sync config.</div>'; return; }

    if (!entries.length) { el.innerHTML = '<div class="lb-empty">No global data yet. Enable sharing in My Stats!</div>'; return; }

    // aggregate by user
    const users = {};
    entries.forEach(r => {
      if (!users[r.userId]) users[r.userId] = { displayName: r.displayName, km: 0, runs: 0, bestPace: Infinity };
      users[r.userId].km += r.dist;
      users[r.userId].runs++;
      if (r.pace < users[r.userId].bestPace) users[r.userId].bestPace = r.pace;
    });
    const sorted = Object.entries(users).map(([uid, u]) => ({ uid, ...u })).sort((a, b) => b.km - a.km);
    const ranks  = ['gold','silver','bronze'];
    el.innerHTML = `
      <div class="section">
        <h3>Total distance</h3>
        ${sorted.map((u, i) => `
          <div class="lb-row${u.uid === Auth.current?.username ? ' lb-me' : ''}">
            <div class="lb-rank ${ranks[i]||''}">${i+1}</div>
            <div class="lb-img-placeholder">${(u.displayName||u.uid).charAt(0).toUpperCase()}</div>
            <div style="flex:1">
              <div class="lb-name">${u.displayName||u.uid}${u.uid===Auth.current?.username?' <span class="badge badge-accent">You</span>':''}</div>
              <div class="lb-sub">${u.runs} run${u.runs>1?'s':''} · best ${Runs.fmtPace(u.bestPace)}</div>
            </div>
            <div class="lb-val">${u.km.toFixed(1)} km</div>
          </div>`).join('')}
      </div>`;
  },

  // ── VERIFIED ──
  async renderVerified() {
    const el = document.getElementById('lb-verified');
    el.innerHTML = '<div class="lb-empty">Loading…</div>';
    let entries = [];
    try {
      const r = await fetch(`${_wurl()}/leaderboard`);
      if (r.ok) entries = await r.json();
    } catch { el.innerHTML = '<div class="lb-empty">Could not load.</div>'; return; }
    const verified = entries.filter(r => r.verified).sort((a,b) => b.date.localeCompare(a.date));
    if (!verified.length) { el.innerHTML = '<div class="lb-empty">No verified runs yet.</div>'; return; }
    el.innerHTML = verified.slice(0, 30).map(r => `
      <div class="run-card" style="cursor:default">
        <div class="rc-head">
          <div>
            <div class="rc-title">${r.name} <span class="badge badge-green">✓ Verified</span></div>
            <div class="rc-date">${r.displayName||r.userId} · ${r.date}</div>
          </div>
        </div>
        <div class="rc-stats">
          <div class="rc-stat"><span>${r.dist.toFixed(2)} km</span></div>
          <div class="rc-stat"><span>${Runs.fmtTime(r.timeSec)}</span></div>
          <div class="rc-stat"><span>${Runs.fmtPace(r.pace)}</span></div>
          ${r.elev ? `<div class="rc-stat"><span>↑${r.elev}m</span></div>` : ''}
        </div>
        ${r.stravaImg ? `<img src="${r.stravaImg}" style="max-width:100%;max-height:160px;object-fit:cover;border-radius:6px;margin-top:8px" alt="Strava proof">` : ''}
      </div>`).join('');
  },

  // ── PER-ROUTE LEADERBOARD ──
  async renderRouteLB(routeId, routeName, containerEl) {
    containerEl.innerHTML = '<div class="lb-empty">Loading…</div>';
    let entries = [];
    try {
      const r = await fetch(`${_wurl()}/route-lb?routeId=${routeId}`);
      if (r.ok) entries = await r.json();
    } catch { containerEl.innerHTML = '<div class="lb-empty">Could not load.</div>'; return; }
    if (!entries.length) { containerEl.innerHTML = '<div class="lb-empty">No runs on this route yet. Be the first!</div>'; return; }
    const ranks = ['gold','silver','bronze'];
    containerEl.innerHTML = `<h3 style="margin-bottom:10px">${routeName} — Leaderboard</h3>` +
      entries.slice(0, 20).map((e, i) => `
        <div class="lb-row${e.userId===Auth.current?.username?' lb-me':''}">
          <div class="lb-rank ${ranks[i]||''}">${i+1}</div>
          <div class="lb-img-placeholder">${(e.displayName||e.userId).charAt(0).toUpperCase()}</div>
          <div style="flex:1">
            <div class="lb-name">${e.displayName||e.userId}</div>
            <div class="lb-sub">${e.dist.toFixed(1)}km · ${e.date}</div>
          </div>
          <div class="lb-val">${Runs.fmtPace(e.pace)}</div>
        </div>`).join('');
  },

  async submitToRouteLB(run, routeId) {
    if (!Auth.syncEnabled()) return;
    try {
      await fetch(`${_wurl()}/route-lb`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId, id: run.id, userId: Auth.current.username,
          displayName: Auth.current.displayName, date: run.date,
          dist: run.dist, timeSec: run.timeSec, pace: run.pace,
          verified: run.verified || false,
        }),
      });
    } catch(e) { console.warn('[route-lb] submit failed', e.message); }
  },

  _personalBests(runs) {
    if (!runs.length) return [];
    const fastest  = runs.reduce((a,b) => a.pace < b.pace ? a : b);
    const longest  = runs.reduce((a,b) => a.dist > b.dist ? a : b);
    const elevKing = runs.reduce((a,b) => (a.elev||0) > (b.elev||0) ? a : b);
    return [
      { label: 'Fastest pace', val: Runs.fmtPace(fastest.pace),       date: fastest.date },
      { label: 'Longest run',  val: `${longest.dist.toFixed(2)} km`,   date: longest.date },
      { label: 'Most elevation', val: `↑${elevKing.elev||0}m`,         date: elevKing.date },
    ];
  },

  _monthlyBreakdown(runs) {
    const months = {};
    runs.forEach(r => {
      const m = r.date.slice(0,7);
      if (!months[m]) months[m] = { km:0, count:0 };
      months[m].km += r.dist; months[m].count++;
    });
    const sorted = Object.entries(months).sort((a,b) => b[0].localeCompare(a[0])).slice(0,6);
    if (!sorted.length) return '<span style="font-size:12px;color:var(--muted2)">No data.</span>';
    return sorted.map(([m,d]) => `
      <div class="goal-item">
        <div style="font-size:13px;font-weight:700">${m}</div>
        <div style="font-size:12px;color:var(--muted2)">${d.count} run${d.count>1?'s':''}</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--accent)">${d.km.toFixed(1)} km</div>
      </div>`).join('');
  },
};

let _currentLBTab = 'local';
function switchLB(tab) {
  _currentLBTab = tab;
  document.querySelectorAll('.lbtab').forEach((t,i) => t.classList.toggle('active', ['local','global','verified'][i] === tab));
  document.querySelectorAll('.lb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`lb-${tab}`).classList.add('active');
  if      (tab === 'local')    Leaderboard.renderLocal();
  else if (tab === 'global')   Leaderboard.renderGlobal();
  else                         Leaderboard.renderVerified();
}
