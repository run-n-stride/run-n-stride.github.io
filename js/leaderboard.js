// leaderboard.js — personal bests, global board (localStorage shared), verified runs
const Leaderboard = {

  // Called when a run is saved — publish to global board
  publishRun(run) {
    const entry = {
      id: run.id,
      userId: Auth.current.username,
      displayName: Auth.current.displayName,
      date: run.date,
      name: run.name,
      dist: run.dist,
      timeSec: run.timeSec,
      pace: run.pace,
      elev: run.elev || 0,
      tags: run.tags || [],
      verified: run.verified || false,
      stravaImg: run.stravaImg || null,
    };
    const global = DB.gget('runs', []);
    // remove old entries from same user+id
    const filtered = global.filter(e => !(e.userId === run.userId && e.id === run.id));
    filtered.unshift(entry);
    // keep last 500 entries
    DB.gset('runs', filtered.slice(0, 500));
  },

  removeRun(id) {
    const global = DB.gget('runs', []);
    DB.gset('runs', global.filter(e => !(e.userId === Auth.current.username && e.id === id)));
  },

  renderLocal() {
    const runs = Runs.all();
    const el = document.getElementById('lb-local');
    if (!runs.length) { el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted2);font-size:13px">No runs yet.</div>'; return; }

    const totalKm = runs.reduce((a, r) => a + r.dist, 0);
    const bestPace = Math.min(...runs.map(r => r.pace));
    const longest = Math.max(...runs.map(r => r.dist));
    const totalTime = runs.reduce((a, r) => a + r.timeSec, 0);

    const pbs = this._personalBests(runs);

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

  _personalBests(runs) {
    if (!runs.length) return [];
    const fastest = runs.reduce((a, b) => a.pace < b.pace ? a : b);
    const longest = runs.reduce((a, b) => a.dist > b.dist ? a : b);
    const elevKing = runs.reduce((a, b) => (a.elev || 0) > (b.elev || 0) ? a : b);
    return [
      { label: 'Fastest pace', val: Runs.fmtPace(fastest.pace), date: fastest.date },
      { label: 'Longest run', val: `${longest.dist.toFixed(2)} km`, date: longest.date },
      { label: 'Most elevation', val: `↑${elevKing.elev || 0}m`, date: elevKing.date },
    ];
  },

  _monthlyBreakdown(runs) {
    const months = {};
    runs.forEach(r => {
      const m = r.date.slice(0, 7);
      if (!months[m]) months[m] = { km: 0, count: 0 };
      months[m].km += r.dist; months[m].count++;
    });
    const sorted = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    if (!sorted.length) return '<span style="font-size:12px;color:var(--muted2)">No data.</span>';
    return sorted.map(([m, d]) => `
      <div class="goal-item">
        <div style="font-size:13px;font-weight:700">${m}</div>
        <div style="font-size:12px;color:var(--muted2)">${d.count} run${d.count > 1 ? 's' : ''}</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--accent)">${d.km.toFixed(1)} km</div>
      </div>`).join('');
  },

  renderGlobal() {
    const el = document.getElementById('lb-global');
    const global = DB.gget('runs', []);

    // aggregate by user — total km + run count
    const users = {};
    global.forEach(r => {
      if (!users[r.userId]) users[r.userId] = { displayName: r.displayName, km: 0, runs: 0, bestPace: Infinity };
      users[r.userId].km += r.dist;
      users[r.userId].runs++;
      if (r.pace < users[r.userId].bestPace) users[r.userId].bestPace = r.pace;
    });

    const sorted = Object.entries(users)
      .map(([uid, u]) => ({ uid, ...u }))
      .sort((a, b) => b.km - a.km);

    if (!sorted.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted2);font-size:13px">No global data yet. Log a run to appear here!</div>';
      return;
    }

    const ranks = ['gold', 'silver', 'bronze'];
    el.innerHTML = `
      <div class="section" style="margin-bottom:14px">
        <h3>Total distance — all users</h3>
        ${sorted.map((u, i) => `
          <div class="lb-row${u.uid === Auth.current?.username ? ' lb-me' : ''}">
            <div class="lb-rank ${ranks[i] || ''}">${i + 1}</div>
            <div class="lb-img-placeholder">${(u.displayName || u.uid).charAt(0).toUpperCase()}</div>
            <div style="flex:1">
              <div class="lb-name">${u.displayName || u.uid}${u.uid === Auth.current?.username ? ' <span class="badge badge-accent">You</span>' : ''}</div>
              <div class="lb-sub">${u.runs} run${u.runs > 1 ? 's' : ''} · best ${Runs.fmtPace(u.bestPace)}</div>
            </div>
            <div class="lb-val">${u.km.toFixed(1)} km</div>
          </div>`).join('')}
      </div>
      ${this._globalFastestPace(global)}`;
  },

  _globalFastestPace(global) {
    const byUser = {};
    global.forEach(r => {
      if (!byUser[r.userId] || r.pace < byUser[r.userId].pace)
        byUser[r.userId] = { ...r };
    });
    const sorted = Object.values(byUser).sort((a, b) => a.pace - b.pace).slice(0, 10);
    if (!sorted.length) return '';
    const ranks = ['gold', 'silver', 'bronze'];
    return `<div class="section">
      <h3>Fastest pace</h3>
      ${sorted.map((r, i) => `
        <div class="lb-row${r.userId === Auth.current?.username ? ' lb-me' : ''}">
          <div class="lb-rank ${ranks[i] || ''}">${i + 1}</div>
          <div class="lb-img-placeholder">${(r.displayName || r.userId).charAt(0).toUpperCase()}</div>
          <div style="flex:1">
            <div class="lb-name">${r.displayName || r.userId}</div>
            <div class="lb-sub">${r.dist.toFixed(1)}km · ${r.date}</div>
          </div>
          <div class="lb-val">${Runs.fmtPace(r.pace)}</div>
        </div>`).join('')}
    </div>`;
  },

  renderVerified() {
    const el = document.getElementById('lb-verified');
    const global = DB.gget('runs', []);
    const verified = global.filter(r => r.verified).sort((a, b) => b.date.localeCompare(a.date));

    if (!verified.length) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted2);font-size:13px">No verified runs yet. Upload a Strava screenshot when logging a run!</div>';
      return;
    }

    el.innerHTML = `<p style="font-size:12px;color:var(--muted2);margin-bottom:12px">Verified runs have a Strava screenshot attached as proof.</p>` +
      verified.slice(0, 30).map(r => `
        <div class="run-card verified" style="cursor:default">
          <div class="rc-head">
            <div>
              <div class="rc-title">${r.name} <span class="badge badge-green">✓ Verified</span></div>
              <div class="rc-date">${r.displayName || r.userId} · ${r.date}</div>
            </div>
          </div>
          <div class="rc-stats">
            <div class="rc-stat"><span>${r.dist.toFixed(2)} km</span></div>
            <div class="rc-stat"><span>${Runs.fmtTime(r.timeSec)}</span></div>
            <div class="rc-stat"><span>${Runs.fmtPace(r.pace)}</span></div>
            ${r.elev ? `<div class="rc-stat"><span>↑${r.elev}m</span></div>` : ''}
          </div>
          ${r.stravaImg ? `<img src="${r.stravaImg}" style="max-width:100%;max-height:160px;object-fit:cover;border-radius:6px;margin-top:8px;border:1px solid var(--border2)" alt="Strava proof">` : ''}
        </div>`).join('');
  },
};

let _currentLBTab = 'local';
function switchLB(tab) {
  _currentLBTab = tab;
  document.querySelectorAll('.lbtab').forEach((t, i) => t.classList.toggle('active', ['local','global','verified'][i] === tab));
  document.querySelectorAll('.lb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`lb-${tab}`).classList.add('active');
  if (tab === 'local') Leaderboard.renderLocal();
  else if (tab === 'global') Leaderboard.renderGlobal();
  else Leaderboard.renderVerified();
}
