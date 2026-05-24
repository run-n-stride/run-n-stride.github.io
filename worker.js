// ── RunTrack Cloudflare Worker ──
// Deploy at: workers.cloudflare.com → Create Worker → paste this → Save
// Then: Settings → Variables → Add secret:
//   GITHUB_TOKEN  =  your fine-grained PAT (Contents: read+write on your repo)
//   GITHUB_OWNER  =  your GitHub username
//   GITHUB_REPO   =  your repo name
//   ALLOWED_ORIGIN = your GitHub Pages URL e.g. https://yourname.github.io

const CORS = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Username',
});

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS(env) });

    const url  = new URL(req.url);
    const user = req.headers.get('X-Username')?.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!user) return json({ error: 'Missing X-Username header' }, 400, env);

    const ghBase = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/sync`;
    const ghHeaders = { Authorization: `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'RunTrack-Worker' };

    // GET /sync  → pull user's data
    if (req.method === 'GET' && url.pathname === '/sync') {
      const res = await fetch(`${ghBase}/${user}.json`, { headers: ghHeaders });
      if (res.status === 404) return json({ data: null }, 200, env);
      if (!res.ok) return json({ error: 'GitHub error ' + res.status }, 502, env);
      const file = await res.json();
      const decoded = JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\n/g, '')))));
      return json(decoded, 200, env);
    }

    // PUT /sync  → push user's data
    if (req.method === 'PUT' && url.pathname === '/sync') {
      const body = await req.json();
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(body))));
      const existing = await fetch(`${ghBase}/${user}.json`, { headers: ghHeaders });
      const payload = { message: `sync: ${user}`, content };
      if (existing.ok) payload.sha = (await existing.json()).sha;
      const res = await fetch(`${ghBase}/${user}.json`, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(payload) });
      if (!res.ok) return json({ error: 'GitHub write error ' + res.status }, 502, env);
      return json({ ok: true }, 200, env);
    }

    return json({ error: 'Not found' }, 404, env);
  }
};

function json(data, status, env) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS(env), 'Content-Type': 'application/json' } });
}
