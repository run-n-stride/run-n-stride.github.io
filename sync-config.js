// sync-config.js — edit these three values, then commit & push.
// Create a fine-grained PAT at: https://github.com/settings/tokens
//   → "Fine-grained tokens" → Generate new token
//   → Repository access: Only this repository
//   → Permissions → Contents: Read and write
// The token only has access to this one repo's file contents. Nothing else.

const SYNC_CONFIG = {
  owner: 'YOUR_GITHUB_USERNAME',   // e.g. 'alice'
  repo:  'YOUR_REPO_NAME',         // e.g. 'runtrack'
  token: 'YOUR_FINE_GRAINED_PAT',  // e.g. 'github_pat_...'
};
