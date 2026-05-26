// ui.js — page-level UI functions
/* global Auth, DB, Runs, Leaderboard, Maps, SYNC_WORKER_URL, scheduleSyncPush */

// ── route confirmation after screenshot upload ──
let _pendingRouteRun = null;
let _confirmMapKey   = null;

function showRouteConfirm(run) {
  _pendingRouteRun = run;
  document.getElementById('route-confirm-modal').style.display = 'flex';
  setTimeout(() => {
    Maps.showRoute('route-confirm-map', 'route-confirm', run.route, {});
    _confirmMapKey = 'route-confirm';
  }, 100);
}

function confirmRoute() {
  document.getElementById('route-confirm-modal').style.display = 'none';
  if (_pendingRouteRun?.route?.length >= 2) {
    askSaveAsRoute(_pendingRouteRun);
  } else {
    showPage('history');
  }
}

function drawRouteByHand() {
  document.getElementById('route-confirm-modal').style.display = 'none';
  document.getElementById('draw-route-modal').style.display = 'flex';
  const center = _pendingRouteRun?.mapCenter || [49.6116, 6.1319];
  setTimeout(() => Maps.init('route-draw-map', 'route-draw', { center, zoom: 14 }), 100);
}

function saveDrawnRoute() {
  const pts = Maps.getPoints('route-draw');
  if (_pendingRouteRun) {
    _pendingRouteRun.route = pts;
    // update saved run
    const runs = Runs.all();
    const idx  = runs.findIndex(r => r.id === _pendingRouteRun.id);
    if (idx > -1) { runs[idx].route = pts; Runs.save(runs); }
  }
  document.getElementById('draw-route-modal').style.display = 'none';
  if (pts.length >= 2) askSaveAsRoute(_pendingRouteRun);
  else showPage('history');
}

function skipRoute() {
  document.getElementById('route-confirm-modal').style.display = 'none';
  document.getElementById('draw-route-modal').style.display = 'none';
  showPage('history');
}

// ── ask if user wants to save as community route ──
function askSaveAsRoute(run) {
  _pendingRouteRun = run;
  document.getElementById('route-prompt-name').value = run.name || '';
  document.getElementById('route-prompt-modal').style.display = 'flex';
}

async function confirmSaveRoute() {
  const name = document.getElementById('route-prompt-name').value.trim() || _pendingRouteRun?.name || 'Unnamed route';
  const run  = _pendingRouteRun;
  document.getElementById('route-prompt-modal').style.display = 'none';
  if (!run?.route?.length) { showPage('history'); return; }

  const route = {
    id: `route_${run.id}`, name, createdBy: Auth.current.username,
    createdAt: new Date().toISOString(), points: run.route, dist: run.dist,
    city: run.city || null,
  };

  // save locally
  const routes = DB.get('global_routes', []);
  routes.unshift(route);
  DB.set('global_routes', routes);

  // push to GitHub
  if (Auth.syncEnabled()) {
    try {
      await fetch(`${_wurl()}/routes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route),
      });
    } catch {}
  }
  showPage('history');
}

function closeRoutePrompt() {
  document.getElementById('route-prompt-modal').style.display = 'none';
  showPage('history');
}

// ── routes page ──
async function renderRoutesPage() {
  const el = document.getElementById('routes-list');
  el.innerHTML = '<div style="color:var(--muted2);font-size:13px;padding:8px 0">Loading routes…</div>';
  let routes = DB.get('global_routes', []);

  // fetch from GitHub
  if (Auth.syncEnabled()) {
    try {
      const r = await fetch(`${_wurl()}/routes`);
      if (r.ok) {
        routes = await r.json();
        DB.set('global_routes', routes);
      }
    } catch {}
  }

  if (!routes.length) {
    el.innerHTML = '<div style="color:var(--muted2);font-size:13px;padding:12px 0">No community routes yet. Upload a Strava screenshot to add the first one!</div>';
    return;
  }

  el.innerHTML = routes.map(r => `
    <div class="run-card" style="margin-bottom:12px">
      <div class="rc-head">
        <div>
          <div class="rc-title">${r.name}${r.city ? ` <span style="font-size:11px;color:var(--muted2)">· ${r.city}</span>` : ''}</div>
          <div class="rc-date">${r.dist ? r.dist.toFixed(1)+'km · ' : ''}by ${r.createdBy}</div>
        </div>
      </div>
      <div id="route-lb-${r.id}" style="margin-top:10px"></div>
      <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="toggleRouteLB('${r.id}','${r.name.replace(/'/g,'')}')">Show leaderboard ▾</button>
    </div>`).join('');
}

const _lbOpen = {};
async function toggleRouteLB(routeId, routeName) {
  const el = document.getElementById(`route-lb-${routeId}`);
  if (_lbOpen[routeId]) { el.innerHTML = ''; _lbOpen[routeId] = false; return; }
  _lbOpen[routeId] = true;
  await Leaderboard.renderRouteLB(routeId, routeName, el);
}

// ── public/private toggle on a run ──
function toggleRunPublic(runId) {
  const runs = Runs.all();
  const run  = runs.find(r => r.id === runId);
  if (!run) return;
  run.isPublic = !run.isPublic;
  if (!run.isPublic) {
    run.stravaImg = null; // strip screenshot for private runs
    Leaderboard.removeRun(runId);
  } else {
    Leaderboard.publishRun(run);
  }
  Runs.save(runs);
  scheduleSyncPush();
  Runs.renderHistory();
}

// ── leaderboard sharing toggle ──
function toggleLBSharing() {
  const next = !DB.get('lb_share', false);
  if (next && !confirm('Enable global leaderboard sharing?\nYour public runs will be visible to all users on the global leaderboard.')) return;
  Leaderboard.setSharing(next);
  document.getElementById('settings-lb-toggle')?.classList.toggle('on', next);
}

// ── data upload toggle ──
function toggleDataUpload() {
  const next = !DB.get('data_upload', false);
  if (next && !confirm('Upload your run data to GitHub for safe keeping?\nNo passwords or usernames are included — only run stats and routes.')) return;
  DB.set('data_upload', next);
  document.getElementById('settings-data-upload-toggle')?.classList.toggle('on', next);
  if (next) scheduleSyncPush();
}
