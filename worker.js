// ── RunTrack Cloudflare Worker ──
// Deploy: workers.cloudflare.com → Create Worker → paste → Save & Deploy
// Then: Settings → Variables → add these (encrypt GITHUB_TOKEN):
//   GITHUB_TOKEN   = github_pat_...  (Contents: read+write on this repo only)
//   GITHUB_OWNER   = your GitHub username
//   GITHUB_REPO    = your repo name
//   ALLOWED_ORIGIN = https://yourname.github.io

// Data is written to the `sync` branch of your repo (not main).
// Create it once: git checkout -b sync && git push origin sync
// No branch protection rules needed — sync branch is data-only.

const CORS = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Username',
});

const GH_BRANCH = 'sync';

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return resp(null, 204, env);

    const url  = new URL(req.url);
    const user = req.headers.get('X-Username')?.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!user) return resp({ error: 'Missing X-Username' }, 400, env);

    const base    = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/sync/${user}.json`;
    const ghHdr   = { Authorization: `token ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'RunTrack' };
    const branchQ = `?ref=${GH_BRANCH}`;

    // ── GET /sync  → pull ──
    if (req.method === 'GET') {
      const res = await fetch(base + branchQ, { headers: ghHdr });
      if (res.status === 404) return resp({ data: null }, 200, env);
      if (!res.ok)            return resp({ error: 'GitHub ' + res.status }, 502, env);
      const file    = await res.json();
      const decoded = JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\n/g, '')))));
      return resp(decoded, 200, env);
    }

    // ── PUT /sync  → push ──
    if (req.method === 'PUT') {
      const body    = await req.json();
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(body))));
      // fetch existing SHA so GitHub accepts the update (no PR, direct commit to sync branch)
      const existing = await fetch(base + branchQ, { headers: ghHdr });
      const payload  = { message: `sync:${user}`, content, branch: GH_BRANCH };
      if (existing.ok) payload.sha = (await existing.json()).sha;
      const res = await fetch(base, { method: 'PUT', headers: ghHdr, body: JSON.stringify(payload) });
      if (!res.ok) return resp({ error: 'GitHub write ' + res.status }, 502, env);
      return resp({ ok: true }, 200, env);
    }

    return resp({ error: 'Not found' }, 404, env);
  }
};

const resp = (data, status, env) =>
  new Response(data ? JSON.stringify(data) : null, {
    status,
    headers: { ...CORS(env), 'Content-Type': 'application/json' }
  });
