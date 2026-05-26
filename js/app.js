// app.js — bootstrap, routing, tag wiring
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id)?.classList.add('active');
  document.querySelector(`.tab[data-page="${id}"]`)?.classList.add('active');

  const handlers = {
    dashboard: () => Runs.renderDashboard(),
    log: () => setTimeout(() => Maps.init('map-log', 'log'), 120),
    live: () => Live.init(),
    history: () => Runs.renderHistory(),
    plan: () => {
      setTimeout(() => Maps.init('map-plan', 'plan'), 120);
      Runs.renderPlans();
      Runs.renderPaceEstimate();
    },
    coach: () => Coach.initPage(),
    leaderboard: () => {
      Leaderboard.renderLocal();
      document.querySelectorAll('.lbtab').forEach((t, i) => t.classList.toggle('active', i === 0));
      document.querySelectorAll('.lb-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('lb-local').classList.add('active');
    },
    settings: () => Runs.loadSettings(),
    routes:   () => renderRoutesPage(),
  };
  handlers[id]?.();
}

function bootApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('sync-prompt').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.getElementById('header-username').textContent = Auth.current.displayName || Auth.current.username;
  DB.init(Auth.current.username);

  // wire up nav tabs
  document.querySelectorAll('.tab[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // wire up tag buttons
  document.querySelectorAll('#feel-tags .tag').forEach(btn => {
    btn.addEventListener('click', () => Runs.toggleTag(btn, btn.dataset.tag, 'log'));
  });
  document.querySelectorAll('#plan-type-tags .tag').forEach(btn => {
    btn.addEventListener('click', () => Runs.toggleTag(btn, btn.dataset.tag, 'plan'));
  });

  // set today's date on forms
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('log-date').value = today;
  document.getElementById('plan-date').value = today;

  showPage('dashboard');

  // pull on every boot so data is always fresh, then set up background push
  if (Auth.syncEnabled()) {
    setTimeout(async () => {
      const r = await Auth.pullSync().catch(e => ({ err: e.message }));
      if (r.err) console.error('[sync] boot pull failed:', r.err);
      else if (!r.empty) {
        // re-render current page with fresh data
        const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
        if (activePage) showPage(activePage);
      }
    }, 1500);
  }
}

// ── startup ──
(async function init() {
  const ok = await Auth.resume();
  if (ok) {
    bootApp();
  }
  // auth screen already visible by default
})();
