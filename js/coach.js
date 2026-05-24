// coach.js — Groq AI coach
const Coach = {
  _history: [],

  _context() {
    const runs = Runs.all();
    const avg = Runs.avgPace();
    const total = runs.reduce((a, r) => a + r.dist, 0);
    const g = DB.get('goals', {});
    const p = DB.get('profile', {});
    const wk = Runs.thisWeek();
    const recent = runs.slice(0, 8).map(r =>
      `${r.date}: ${r.dist.toFixed(1)}km ${Runs.fmtTime(r.timeSec)} @ ${Runs.fmtPace(r.pace)} elev:${r.elev || 0}m [${(r.tags || []).join(',')}]`
    ).join('\n');
    const warmup = DB.get('warmup', '');

    return `You are a personal AI running coach. Be specific, encouraging, and direct. Reference real data.

RUNNER: ${p.displayName || Auth.current?.displayName || 'Runner'} | weight: ${p.weight || '?'}kg | 5k PR: ${p.pr5k || 'not set'} | 10k PR: ${p.pr10k || 'not set'}
TOTALS: ${runs.length} runs | ${total.toFixed(1)}km total | avg pace: ${Runs.fmtPace(Math.round(avg))} | best: ${runs.length ? Runs.fmtPace(Math.min(...runs.map(r => r.pace))) : '—'}
THIS WEEK: ${wk.length} runs | ${wk.reduce((a, r) => a + r.dist, 0).toFixed(1)}km
GOALS: weekly ${g.weeklyKm || 0}km, ${g.weeklyRuns || 0} runs, ${g.weeklyTime || 0}min | pace goal: ${g.paceOn ? `${g.paceType} ${Runs.fmtPace(parseInt(g.paceMin || 5) * 60 + parseInt(g.paceSecVal || 30))}` : 'none'}
WARMUP: ${warmup || 'not set'}
RECENT RUNS:\n${recent || 'none yet'}`;
  },

  async call(userMsg) {
    const key = Auth.groqKey();
    if (!key) throw new Error('No Groq API key — add it in Settings');
    const messages = [
      { role: 'system', content: this._context() },
      ...this._history.slice(-10),
      { role: 'user', content: userMsg }
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 900, temperature: 0.7 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const d = await res.json();
    return d.choices[0].message.content;
  },

  async chat(msg) {
    this._addMsg('user', msg);
    this._history.push({ role: 'user', content: msg });
    const typing = this._showTyping();
    try {
      const reply = await this.call(msg);
      typing.remove();
      this._addMsg('ai', reply);
      this._history.push({ role: 'assistant', content: reply });
    } catch (e) {
      typing.remove();
      this._addMsg('ai', `Error: ${e.message}`);
    }
  },

  async quickInsight(type) {
    const prompts = {
      improve: 'Based on my running history, give me 3 specific, actionable ways to improve. Reference my actual stats and pace.',
      stats: 'Do a deep analysis of my running stats. What patterns, strengths, weaknesses, and trends do you see?',
      recovery: 'Based on my recent training load, assess my recovery needs. Should I rest, do easy miles, or train hard tomorrow?',
      week: 'Write a 7-day training plan for me based on my history, current fitness, and weekly goals. Give specific days, distances, and paces.',
    };
    showPage('coach');
    await this.chat(prompts[type]);
  },

  async genWarmup() {
    const p = DB.get('profile', {});
    const existing = document.getElementById('warmup-txt').value;
    const prompt = `Generate a personalised 5-8 minute dynamic warmup routine for a runner. 
Stats: avg pace ${Runs.fmtPace(Math.round(Runs.avgPace()))}, ${Runs.all().length} logged runs.
${existing ? `Their current warmup: ${existing}` : 'They have no warmup yet.'}
Give numbered steps with duration/reps and a brief reason for each. Be specific and practical.`;
    const btn = document.querySelector('[onclick="genWarmup()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    try {
      const reply = await this.call(prompt);
      document.getElementById('warmup-txt').value = reply;
      DB.set('warmup', reply);
      this.showWarmupDisplay();
    } catch (e) { alert('Error: ' + e.message); }
    if (btn) { btn.disabled = false; btn.textContent = 'Generate for me ✦'; }
  },

  async aiPaceStrategy() {
    const dist = Runs.parseDist(document.getElementById('plan-dist')?.value);
    const elev = parseInt(document.getElementById('plan-elev')?.value) || 0;
    const tags = document.querySelectorAll('#plan-type-tags .tag.active');
    const type = [...tags].map(t => t.dataset.tag).join(', ');
    if (!dist) { alert('Enter a target distance first.'); return; }
    const btn = document.getElementById('btn-ai-strat');
    btn.disabled = true; btn.textContent = 'Thinking...';
    const prompt = `The runner is planning a ${dist}km ${type || 'run'} with ${elev}m elevation gain.
Their recent avg pace is ${Runs.fmtPace(Math.round(Runs.avgPace()))}.
Provide a detailed segment-by-segment pace strategy (4-6 segments). For each: km range, target pace (mm:ss/km), difficulty, and one precise tactical instruction. 
Then give 2-3 specific tips to execute this run well based on their history. Be concise and direct.`;
    try {
      const reply = await this.call(prompt);
      document.getElementById('pace-strategy').innerHTML =
        `<div style="font-size:13px;line-height:1.75;white-space:pre-wrap">${reply}</div>`;
    } catch (e) {
      document.getElementById('pace-strategy').innerHTML =
        `<span style="color:var(--red);font-size:12px">Error: ${e.message}</span>`;
    }
    btn.disabled = false; btn.textContent = 'AI pace strategy ✦';
  },

  showWarmupDisplay() {
    const txt = document.getElementById('warmup-txt').value;
    const el = document.getElementById('warmup-display');
    if (!txt) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = txt.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  },

  initPage() {
    const noKey = document.getElementById('coach-no-key');
    if (noKey) noKey.style.display = Auth.groqKey() ? 'none' : 'block';
    const wu = DB.get('warmup', '');
    if (wu) document.getElementById('warmup-txt').value = wu;
  },

  _addMsg(role, text) {
    const el = document.createElement('div');
    el.className = `msg msg-${role}`;
    el.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>');
    const w = document.getElementById('chat-window');
    w.appendChild(el);
    w.scrollTop = w.scrollHeight;
  },

  _showTyping() {
    const el = document.createElement('div');
    el.className = 'msg msg-typing';
    el.textContent = 'Coach is thinking...';
    const w = document.getElementById('chat-window');
    w.appendChild(el);
    w.scrollTop = w.scrollHeight;
    return el;
  },
};

function sendChat() {
  const input = document.getElementById('chat-in');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  Coach.chat(msg);
}

function qi(type) { Coach.quickInsight(type); }
function genWarmup() { Coach.genWarmup(); }
function toggleWarmupDisplay() { Coach.showWarmupDisplay(); }
function getAIStrategy() { Coach.aiPaceStrategy(); }
function saveWarmup() { DB.set('warmup', document.getElementById('warmup-txt').value); }
