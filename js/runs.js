// runs.js — run CRUD, pace maths, plan engine
const Runs = {
  _selectedTags: { log: new Set(), plan: new Set() },
  _uploadedImage: null,   // base64 string
  _detailMapKey: null,

  // ── persistence ──
  all: () => DB.get('runs', []),
  save: (runs) => DB.set('runs', runs),

  add(run) {
    const runs = this.all();
    runs.unshift(run);
    this.save(runs);
    Leaderboard.publishRun(run);
  },

  delete(id) {
    this.save(this.all().filter(r => r.id !== id));
    Leaderboard.removeRun(id);
  },

  // ── maths ──
  parseDist: v => parseFloat(v) || 0,

  parseTime(s) {
    if (!s) return 0;
    const p = s.split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + (p[1] || 0);
    return p[0] * 60;
  },

  fmtPace(spk) {
    if (!spk || spk <= 0 || !isFinite(spk)) return '—';
    const m = Math.floor(spk / 60), s = Math.round(spk % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}/km`;
  },

  fmtTime(secs) {
    secs = Math.round(secs);
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  },

  calcPace: (dist, secs) => (!dist || !secs) ? 0 : secs / dist,

  avgPace(n = 10) {
    const recent = this.all().slice(0, n).filter(r => r.pace > 0);
    if (!recent.length) return 0;
    return recent.reduce((a, r) => a + r.pace, 0) / recent.length;
  },

  elevPenalty: (elevM, distKm) => elevM && distKm ? (elevM / distKm / 10) * 12 : 0,

  estimatePace(dist, elev) {
    const avg = this.avgPace();
    if (!avg) return 0;
    const fatigueBonus = dist > 15 ? (dist - 15) * 2 : dist > 10 ? (dist - 10) * 1.5 : 0;
    return avg + this.elevPenalty(elev, dist) + fatigueBonus;
  },

  weekStreak() {
    const runs = this.all();
    if (!runs.length) return 0;
    const weeks = new Set(runs.map(r => {
      const d = new Date(r.date), dow = d.getDay();
      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
      return d.toISOString().split('T')[0];
    }));
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 52; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      const dow = d.getDay();
      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
      if (weeks.has(d.toISOString().split('T')[0])) streak++;
      else break;
    }
    return streak;
  },

  thisWeek() {
    const now = new Date(), dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    mon.setHours(0, 0, 0, 0);
    return this.all().filter(r => new Date(r.date) >= mon);
  },

  // ── save run from form ──
  saveFromForm() {
    const dist = this.parseDist(document.getElementById('log-dist').value);
    const timeSec = this.parseTime(document.getElementById('log-time').value);
    const date = document.getElementById('log-date').value || new Date().toISOString().split('T')[0];
    if (!dist || !timeSec) { alert('Enter distance and time.'); return; }

    const run = {
      id: Date.now(),
      userId: Auth.current.username,
      displayName: Auth.current.displayName,
      date,
      name: document.getElementById('log-name').value || `Run ${date}`,
      dist, timeSec,
      elev: parseInt(document.getElementById('log-elev').value) || 0,
      pace: this.calcPace(dist, timeSec),
      notes: document.getElementById('log-notes').value,
      tags: [...this._selectedTags.log],
      route: Maps.getPoints('log'),
      stravaImg: this._uploadedImage || null,
      verified: !!this._uploadedImage,
    };
    this.add(run);

    // reset
    ['log-name','log-dist','log-time','log-elev','log-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
    document.querySelectorAll('#feel-tags .tag').forEach(t => t.classList.remove('active'));
    this._selectedTags.log.clear();
    this._uploadedImage = null;
    document.getElementById('upload-preview').innerHTML = '';
    Maps.clear('log');
    document.getElementById('pace-preview').style.display = 'none';
    showPage('history');
  },

  // ── UI renderers ──
  renderHistory() {
    const q = (document.getElementById('search-runs')?.value || '').toLowerCase();
    const sort = document.getElementById('sort-runs')?.value || 'newest';
    let runs = this.all().filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q) ||
      (r.tags || []).some(t => t.toLowerCase().includes(q))
    );
    if (sort === 'oldest') runs.sort((a, b) => a.date.localeCompare(b.date));
    else if (sort === 'longest') runs.sort((a, b) => b.dist - a.dist);
    else if (sort === 'fastest') runs.sort((a, b) => a.pace - b.pace);
    else runs.sort((a, b) => b.date.localeCompare(a.date));

    this.closeDetail();
    const el = document.getElementById('run-list');
    if (!runs.length) { el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted2);font-size:13px">No runs yet. Log your first run!</div>'; return; }
    el.innerHTML = runs.map(r => this._runCardHTML(r)).join('');
    el.querySelectorAll('.run-card').forEach(card => {
      card.addEventListener('click', () => this.openDetail(parseInt(card.dataset.id)));
    });
  },

  _runCardHTML(r) {
    const tags = (r.tags || []).map(t => `<span class="badge badge-blue">${t}</span>`).join('');
    const verBadge = r.verified ? '<span class="badge badge-green">✓ Verified</span>' : '';
    return `<div class="run-card${r.verified ? ' verified' : ''}" data-id="${r.id}">
      <div class="rc-head">
        <div><div class="rc-title">${r.name}</div><div class="rc-date">${r.date}</div></div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">${verBadge}${tags}</div>
      </div>
      <div class="rc-stats">
        <div class="rc-stat"><span>${r.dist.toFixed(2)} km</span></div>
        <div class="rc-stat"><span>${this.fmtTime(r.timeSec)}</span></div>
        <div class="rc-stat"><span>${this.fmtPace(r.pace)}</span></div>
        ${r.elev ? `<div class="rc-stat"><span>↑${r.elev}m</span></div>` : ''}
      </div>
    </div>`;
  },

  openDetail(id) {
    const r = this.all().find(x => x.id === id);
    if (!r) return;
    const profile = DB.get('profile', {});
    const cals = profile.weight ? Math.round(r.dist * profile.weight * 0.9) : null;
    const mapHtml = r.route?.length ? `<div id="detail-map" style="height:220px;border-radius:8px;margin:12px 0;border:1px solid var(--border)"></div>` : '';
    const imgHtml = r.stravaImg ? `<img src="${r.stravaImg}" style="max-width:100%;border-radius:8px;margin:10px 0;border:1px solid var(--border2)" alt="Strava proof">` : '';

    document.getElementById('run-detail').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <b style="font-size:15px">${r.name}</b>
        <button class="btn btn-ghost btn-sm" onclick="Runs.closeDetail()">✕</button>
      </div>
      <div class="grid-3" style="margin-bottom:12px">
        <div class="stat-card"><div class="val">${r.dist.toFixed(2)}</div><div class="lbl">km</div></div>
        <div class="stat-card"><div class="val">${this.fmtPace(r.pace)}</div><div class="lbl">Pace</div></div>
        <div class="stat-card"><div class="val">${this.fmtTime(r.timeSec)}</div><div class="lbl">Time</div></div>
      </div>
      ${r.elev ? `<div style="font-size:12px;color:var(--muted2);margin-bottom:6px">Elevation ↑${r.elev}m</div>` : ''}
      ${cals ? `<div style="font-size:12px;color:var(--muted2);margin-bottom:6px">~${cals} kcal</div>` : ''}
      ${r.notes ? `<div style="font-size:13px;margin-bottom:10px;line-height:1.6">${r.notes}</div>` : ''}
      ${imgHtml}${mapHtml}
      <button class="btn btn-danger-ghost btn-sm" onclick="Runs.deleteRun(${r.id})">Delete run</button>
    `;
    document.getElementById('run-detail').classList.add('open');

    if (r.route?.length) {
      this._detailMapKey = `detail_${id}`;
      setTimeout(() => Maps.showRoute('detail-map', this._detailMapKey, r.route), 80);
    }
  },

  closeDetail() {
    const el = document.getElementById('run-detail');
    el.classList.remove('open');
    el.innerHTML = '';
    if (this._detailMapKey) {
      Maps._maps[this._detailMapKey]?.remove();
      delete Maps._maps[this._detailMapKey];
      this._detailMapKey = null;
    }
  },

  deleteRun(id) {
    if (!confirm('Delete this run?')) return;
    this.delete(id);
    this.closeDetail();
    this.renderHistory();
  },

  renderDashboard() {
    const all = this.all();
    const totalKm = all.reduce((a, r) => a + r.dist, 0);
    const avgPace = all.length ? all.reduce((a, r) => a + r.pace, 0) / all.length : 0;
    const bestPace = all.length ? Math.min(...all.map(r => r.pace)) : 0;
    const longest = all.length ? Math.max(...all.map(r => r.dist)) : 0;

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card"><div class="val">${all.length}</div><div class="lbl">Runs</div></div>
      <div class="stat-card"><div class="val">${totalKm.toFixed(1)}</div><div class="lbl">Total km</div></div>
      <div class="stat-card"><div class="val">${this.fmtPace(Math.round(avgPace))}</div><div class="lbl">Avg pace</div></div>
      <div class="stat-card"><div class="val">${this.weekStreak()}</div><div class="lbl">Wk streak</div></div>
    `;

    // 8-week bar chart
    const now = new Date();
    const bars = [];
    for (let w = 7; w >= 0; w--) {
      const wStart = new Date(now); wStart.setDate(now.getDate() - w * 7); wStart.setHours(0,0,0,0);
      const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
      const km = all.filter(r => { const d = new Date(r.date); return d >= wStart && d < wEnd; }).reduce((a, r) => a + r.dist, 0);
      bars.push({ km, label: `W${8 - w}` });
    }
    const maxKm = Math.max(...bars.map(b => b.km), 1);
    document.getElementById('weekly-chart').innerHTML = bars.map(b => `
      <div class="bar-col">
        <div style="font-size:9px;color:var(--muted2)">${b.km > 0 ? b.km.toFixed(0) : ''}</div>
        <div class="bar-fill" style="height:${Math.max(3, b.km / maxKm * 64)}px;background:${b.km > 0 ? 'var(--accent)' : 'var(--border)'}"></div>
        <div class="bar-lbl">${b.label}</div>
      </div>`).join('');

    this.renderGoalProgress('dash-goals');

    const rec = document.getElementById('dash-recent');
    rec.innerHTML = all.slice(0, 4).map(r => `
      <div class="goal-item">
        <div><div style="font-size:13px;font-weight:700">${r.name}</div>
        <div style="font-size:11px;color:var(--muted2)">${r.dist.toFixed(2)}km · ${this.fmtPace(r.pace)}</div></div>
        <div style="font-size:11px;color:var(--muted2)">${r.date}</div>
      </div>`).join('') || '<span style="font-size:12px;color:var(--muted2)">No runs yet.</span>';
  },

  renderGoalProgress(containerId) {
    const g = DB.get('goals', {});
    const el = document.getElementById(containerId);
    if (!el) return;
    const wk = this.thisWeek();
    const wkm = wk.reduce((a, r) => a + r.dist, 0);
    const wrun = wk.length;
    const wtime = wk.reduce((a, r) => a + r.timeSec, 0);
    const items = [];
    if (g.weeklyKm) items.push({ label: `Distance: ${wkm.toFixed(1)} / ${g.weeklyKm} km`, pct: Math.min(100, Math.round(wkm / g.weeklyKm * 100)) });
    if (g.weeklyRuns) items.push({ label: `Runs: ${wrun} / ${g.weeklyRuns}`, pct: Math.min(100, Math.round(wrun / g.weeklyRuns * 100)) });
    if (g.weeklyTime) items.push({ label: `Time: ${Math.round(wtime / 60)} / ${g.weeklyTime} min`, pct: Math.min(100, Math.round(wtime / 60 / g.weeklyTime * 100)) });
    if (!items.length) { el.innerHTML = '<span style="font-size:12px;color:var(--muted2)">Set goals in Settings.</span>'; return; }
    el.innerHTML = items.map(it => `
      <div class="goal-item">
        <div style="flex:1"><div style="font-size:13px">${it.label}</div>
        <div class="goal-bar"><div class="goal-bar-fill" style="width:${it.pct}%;background:${it.pct >= 100 ? 'var(--green)' : 'var(--accent)'}"></div></div></div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;margin-left:10px;color:${it.pct >= 100 ? 'var(--green)' : 'var(--muted2)'}">${it.pct}%</div>
      </div>`).join('');
  },

  // ── pace preview on log form ──
  updatePacePreview() {
    const dist = this.parseDist(document.getElementById('log-dist').value);
    const timeSec = this.parseTime(document.getElementById('log-time').value);
    const el = document.getElementById('pace-preview');
    if (dist > 0 && timeSec > 0) {
      const pace = this.calcPace(dist, timeSec);
      const g = DB.get('goals', {});
      let cmp = '';
      if (g.paceOn && g.paceMin) {
        const gSec = parseInt(g.paceMin) * 60 + (parseInt(g.paceSecVal) || 0);
        const ok = g.paceType === 'under' ? pace <= gSec : pace >= gSec;
        cmp = ok ? ` <span style="color:var(--green)">✓ goal ${this.fmtPace(gSec)}</span>`
                 : ` <span style="color:var(--red)">✗ goal ${this.fmtPace(gSec)}</span>`;
      }
      el.style.display = 'block';
      el.innerHTML = `Pace: <b>${this.fmtPace(pace)}</b>${cmp} &nbsp;·&nbsp; ${this.fmtTime(timeSec)}`;
    } else { el.style.display = 'none'; }
  },

  // ── plan estimate ──
  renderPaceEstimate() {
    const dist = this.parseDist(document.getElementById('plan-dist')?.value);
    const elev = parseInt(document.getElementById('plan-elev')?.value) || 0;
    const el = document.getElementById('pace-estimate');
    if (!el) return;
    if (!dist) { el.innerHTML = '<span style="font-size:12px;color:var(--muted2)">Enter distance above.</span>'; return; }
    const avg = this.avgPace();
    if (!avg) { el.innerHTML = '<span style="font-size:12px;color:var(--muted2)">Log some runs first.</span>'; return; }
    const est = this.estimatePace(dist, elev);
    const estTime = est * dist;
    el.innerHTML = `
      <div class="grid-3" style="margin-bottom:8px">
        <div class="stat-card"><div class="val">${this.fmtPace(Math.round(est))}</div><div class="lbl">Est. pace</div></div>
        <div class="stat-card"><div class="val">${this.fmtTime(Math.round(estTime))}</div><div class="lbl">Est. time</div></div>
        <div class="stat-card"><div class="val">${this.fmtPace(Math.round(avg))}</div><div class="lbl">Your avg</div></div>
      </div>
      <div style="font-size:11px;color:var(--muted2)">Based on last ${Math.min(this.all().length, 10)} runs${elev ? ` · +${elev}m elevation adds ~${Math.round(this.elevPenalty(elev, dist))}s/km` : ''}</div>`;
    this.renderSegmentStrategy(dist, elev, est);
  },

  renderSegmentStrategy(dist, elev, avgPace) {
    const el = document.getElementById('pace-strategy');
    if (!el || !dist) return;
    const n = Math.max(3, Math.min(6, Math.round(dist)));
    const segKm = dist / n;
    const segs = [];
    for (let i = 0; i < n; i++) {
      const isFirst = i === 0, isLast = i === n - 1;
      const segElv = elev ? Math.round(elev * (isFirst ? 0.35 : isLast ? 0.05 : 0.6 / Math.max(n - 2, 1))) : 0;
      let pace = avgPace + (isFirst ? 8 : isLast ? -12 : segElv * 0.3);
      const type = pace > avgPace + 10 ? 'hard' : pace < avgPace - 5 ? 'easy' : 'mod';
      const note = isFirst ? 'Start controlled — don\'t go out too fast'
        : isLast ? 'Final stretch — time to push if you have it'
        : segElv > 30 ? `Climb ~${segElv}m — shorten stride, lean forward, keep breathing`
        : 'Steady rhythm — settle into goal pace';
      segs.push({ km: `${(i * segKm).toFixed(1)}–${((i + 1) * segKm).toFixed(1)}km`, pace: this.fmtPace(Math.round(pace)), type, elv: segElv > 0 ? `↑${segElv}m` : 'flat', note });
    }
    el.innerHTML = segs.map(s => `
      <div class="seg seg-${s.type}">
        <div class="seg-dot"></div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span class="seg-km">${s.km}</span>
            <span class="seg-pace">${s.pace}</span>
            <span style="font-size:11px;color:var(--muted2)">${s.elv}</span>
          </div>
          <div class="seg-note">${s.note}</div>
        </div>
      </div>`).join('');
  },

  // ── plans ──
  savePlan() {
    const plans = DB.get('plans', []);
    plans.unshift({
      id: Date.now(),
      date: document.getElementById('plan-date').value || new Date().toISOString().split('T')[0],
      dist: this.parseDist(document.getElementById('plan-dist').value),
      elev: parseInt(document.getElementById('plan-elev').value) || 0,
      tags: [...this._selectedTags.plan],
      notes: document.getElementById('plan-notes').value,
      route: Maps.getPoints('plan'),
    });
    DB.set('plans', plans);
    ['plan-dist','plan-elev','plan-notes'].forEach(id => document.getElementById(id).value = '');
    document.querySelectorAll('#plan-type-tags .tag').forEach(t => t.classList.remove('active'));
    this._selectedTags.plan.clear();
    Maps.clear('plan');
    this.renderPlans();
  },

  renderPlans() {
    const el = document.getElementById('saved-plans');
    const plans = DB.get('plans', []);
    if (!plans.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h3 style="margin-bottom:8px">Saved plans</h3>' +
      plans.slice(0, 5).map(p => `
        <div class="run-card">
          <div class="rc-head">
            <div><div class="rc-title">${p.date}${p.dist ? ` · ${p.dist}km` : ''}</div>
            <div class="rc-date">${(p.tags || []).join(', ')}</div></div>
            <button class="btn btn-danger-ghost btn-sm" onclick="Runs.deletePlan(${p.id})">✕</button>
          </div>
          ${p.notes ? `<div style="font-size:11px;color:var(--muted2)">${p.notes}</div>` : ''}
        </div>`).join('');
  },

  deletePlan(id) {
    DB.set('plans', DB.get('plans', []).filter(p => p.id !== id));
    this.renderPlans();
  },

  // ── tag toggle ──
  toggleTag(btn, tag, group) {
    const set = this._selectedTags[group];
    if (set.has(tag)) { set.delete(tag); btn.classList.remove('active'); }
    else { set.add(tag); btn.classList.add('active'); }
  },

  // ── settings ──
  loadSettings() {
    const g = DB.get('goals', {}), p = DB.get('profile', {});
    if (g.weeklyKm) document.getElementById('g-km').value = g.weeklyKm;
    if (g.weeklyRuns) document.getElementById('g-runs').value = g.weeklyRuns;
    if (g.weeklyTime) document.getElementById('g-time').value = g.weeklyTime;
    if (p.weight) document.getElementById('s-weight').value = p.weight;
    if (p.pr5k) document.getElementById('s-5k').value = p.pr5k;
    if (p.pr10k) document.getElementById('s-10k').value = p.pr10k;
    if (p.displayName) document.getElementById('s-display').value = p.displayName;
    const key = Auth.groqKey();
    if (key) document.getElementById('settings-groq').value = key;
    const tog = document.getElementById('pace-tog');
    if (g.paceOn) { tog.classList.add('on'); document.getElementById('pace-goal-inputs').style.display = 'block'; }
    if (g.paceMin) document.getElementById('g-pace-min').value = g.paceMin;
    if (g.paceSecVal) document.getElementById('g-pace-sec').value = g.paceSecVal;
    if (g.paceType) document.getElementById('g-pace-dir').value = g.paceType;
  },
};

// ── global shims ──
function saveRun() { Runs.saveFromForm(); }
function updatePacePreview() { Runs.updatePacePreview(); }
function renderPaceEstimate() { Runs.renderPaceEstimate(); }
function savePlan() { Runs.savePlan(); }

function saveGoals() {
  const g = DB.get('goals', {});
  DB.set('goals', {
    ...g,
    weeklyKm: parseFloat(document.getElementById('g-km')?.value) || 0,
    weeklyRuns: parseInt(document.getElementById('g-runs')?.value) || 0,
    weeklyTime: parseInt(document.getElementById('g-time')?.value) || 0,
    paceOn: g.paceOn,
    paceMin: document.getElementById('g-pace-min')?.value || '5',
    paceSecVal: document.getElementById('g-pace-sec')?.value || '30',
    paceType: document.getElementById('g-pace-dir')?.value || 'under',
  });
}

function togglePaceGoal() {
  const g = DB.get('goals', {});
  g.paceOn = !g.paceOn;
  DB.set('goals', g);
  document.getElementById('pace-tog').classList.toggle('on', g.paceOn);
  document.getElementById('pace-goal-inputs').style.display = g.paceOn ? 'block' : 'none';
}

function saveProfile() {
  const p = {
    displayName: document.getElementById('s-display').value,
    weight: parseFloat(document.getElementById('s-weight').value) || 0,
    pr5k: document.getElementById('s-5k').value,
    pr10k: document.getElementById('s-10k').value,
  };
  DB.set('profile', p);
  if (p.displayName) Auth.updateProfile(p.displayName);
}

function saveGroqKey() {
  Auth.saveGroqKey(document.getElementById('settings-groq').value.trim());
  const el = document.getElementById('key-saved-msg');
  el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 2000);
}

function exportData() {
  const data = { runs: Runs.all(), goals: DB.get('goals', {}), plans: DB.get('plans', []), profile: DB.get('profile', {}) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `runtrack_${Auth.current.username}_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

function clearData() {
  if (!confirm('Delete your account and ALL data? This cannot be undone.')) return;
  Auth.deleteAccount();
  location.reload();
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    Runs._uploadedImage = ev.target.result;
    document.getElementById('upload-preview').innerHTML =
      `<img src="${ev.target.result}" alt="Strava screenshot"><div style="font-size:11px;color:var(--green);margin-top:6px">✓ Image attached — run will be marked as verified</div>`;
    document.getElementById('upload-zone').style.borderColor = 'var(--green)';
  };
  reader.readAsDataURL(file);
}
