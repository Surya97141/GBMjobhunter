// ─── PRODUCTION DEPLOYMENT CONFIG ─────────────────────────────────────────────
//
// SWAP THESE TWO VALUES TO PRODUCTION URLS BEFORE PACKAGING FOR DISTRIBUTION.
//
// In local development these default to localhost — no change needed for dev.
// Before uploading to the Chrome Web Store or sharing a packaged .zip:
//
//   1. Set API_BASE    → your deployed gateway URL
//                        e.g. 'https://gbm-gateway.up.railway.app'
//   2. Set WEB_APP_URL → your deployed web app URL
//                        e.g. 'https://gbm-web.up.railway.app'
//
// Also update manifest.json (JSON has no comment syntax — listed here instead):
//   - externally_connectable.matches: replace 'http://localhost:5173/*'
//     with your production web app URL + '/*' so the web app can message
//     the extension after login
//   - host_permissions: 'http://localhost/*' is dev-only; remove or replace
//     with your production gateway domain before publishing
// ──────────────────────────────────────────────────────────────────────────────

const API_BASE    = 'http://localhost:3000';
const WEB_APP_URL = 'http://localhost:5173';
