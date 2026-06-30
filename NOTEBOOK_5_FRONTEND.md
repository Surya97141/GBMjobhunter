# Notebook 5 — Frontend: Web App, Design System, Extension, and Mobile

---

## 1. All Routes

The web app uses React Router. All routes are defined in `web/src/App.jsx`. Every page component is loaded with `lazy()`, meaning the JavaScript bundle for each page is downloaded only when that route is first visited.

| URL | Public or Protected | Component file | What it shows |
|-----|---------------------|----------------|---------------|
| `/` | Public | `pages/LandingPage.jsx` | Marketing landing page, no auth required |
| `/login` | Public | `pages/LoginPage.jsx` | Email + password login form |
| `/register` | Public | `pages/RegisterPage.jsx` | Account creation form |
| `/dashboard` | Protected | `pages/DashboardPage.jsx` | Main dashboard, job stats overview |
| `/dashboard/tracker` | Protected | `pages/KanbanPage.jsx` | Kanban board for tracking applications |
| `/dashboard/insights` | Protected | `pages/InsightsPage.jsx` | AI-generated insight cards from the pipeline |
| `/dashboard/profile` | Protected | `pages/ProfilePage.jsx` | User profile, resume upload, cover letter template |
| `/dashboard/opportunities` | Protected | `pages/OpportunitiesPage.jsx` | Recommended job opportunities |

**How the protected routes work structurally:**

The four `/dashboard/*` routes are nested inside a single parent route that renders `DashboardLayout`. This means `DashboardLayout` (the sidebar + the content shell) mounts once when you first hit `/dashboard` and stays mounted as you navigate between `/dashboard/tracker`, `/dashboard/insights`, and so on. The sidebar is never re-mounted during internal navigation.

Inside `DashboardLayout`, a `<Outlet />` from React Router renders whichever child page is currently active.

**Route wrapping:**

Every route — public and protected — is wrapped in a `<PageTransition>` component, which provides the animated page enter/exit effect. Page transitions are coordinated by `<AnimatePresence mode="wait">` from `framer-motion`, which ensures the old page finishes its exit animation before the new one enters. The `key` passed to `<Routes>` is `location.pathname` so Framer Motion sees each navigation as a component replacement.

---

## 2. Authentication Flow

### How the JWT is stored

The token is stored in the browser's `localStorage` under the key `gbm_token`. This constant is defined as `TOKEN_KEY = 'gbm_token'` in `web/src/context/AuthContext.jsx`.

`localStorage` persists across tabs and browser restarts until explicitly cleared. This is what enables "stay logged in" behaviour — reopening the tab still has the token.

### How AuthProvider initialises on page load

`AuthProvider` in `web/src/context/AuthContext.jsx` has a `useEffect` that runs once when the app first mounts:

1. It reads `localStorage.getItem('gbm_token')`. The initial `token` state is set to this value via a lazy initialiser: `useState(() => localStorage.getItem(TOKEN_KEY))`.
2. If a token exists, it immediately calls `GET /users/me` through the axios client (which attaches the token as a header — see below). This verifies the token is still valid.
3. If the request succeeds, `user` is set to the returned user object (`res.data.data.user`).
4. If the request fails with 401 (expired or invalid token), the stored token is removed from localStorage and `token` state is set to null.
5. Either way, `loading` is set to `false` when done.

While `loading` is `true`, the app does not know whether the user is authenticated. This state is consumed by `ProtectedRoute`.

### How useAuth() works

`useAuth()` is a hook exported from `web/src/context/AuthContext.jsx`. It returns:

```js
{ user, token, loading, login, register, logout }
```

- `user` — the user object from the API (`{ id, email, name, target_location, ... }`), or `null` if not logged in
- `token` — the raw JWT string, or `null`
- `loading` — `true` while the page-load token verification request is in flight
- `login(email, password)` — calls `POST /auth/login`, stores the returned token and user object, notifies the extension
- `register(email, password)` — calls `POST /auth/register`, same storage behaviour
- `logout()` — removes the token from localStorage, sets token and user to null

`useAuth()` throws if called outside of `<AuthProvider>`. The `AuthProvider` is the second-outermost wrapper in `App.jsx` (inside `BrowserRouter`, wrapping `AnimatedRoutes`), so every page component can safely call `useAuth()`.

### How ProtectedRoute redirects unauthenticated users

`web/src/components/ProtectedRoute.jsx`:

```js
const { token, loading } = useAuth();
if (loading) return null;
if (!token)  return <Navigate to="/login" replace />;
return children;
```

Three cases:
1. **Still loading** (token verification request in flight): renders nothing. The screen is blank while the check runs. This prevents a flash where the user briefly sees the login page before the session is restored.
2. **No token** (definitely not authenticated): redirects to `/login`. The `replace` flag means pressing the browser back button won't return to the protected route — it goes to wherever the user was before the redirect.
3. **Token present**: renders the protected content.

### How the token is attached to API requests

The axios client in `web/src/api/client.js` has a request interceptor:

```js
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('gbm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

Every request made through this client automatically gets the `Authorization: Bearer <jwt>` header. The interceptor reads directly from localStorage rather than from React context — the comment in the file explains this: reading from context would create a circular import (the client is imported by the context). This means the token is always current even if it was just written to localStorage by `login()` — no React re-render is needed.

### Extension token handoff

After a successful `login()` or `register()`, `AuthContext` calls:

```js
window.postMessage({ type: 'GBM_SET_TOKEN', token }, window.location.origin)
```

If the GBM Chrome extension is installed, its content script is running on the web app page and listens for this message. It relays the token to the background service worker, which stores it in `chrome.storage.local` under `auth_token`. This is how the extension gets authenticated without requiring the user to log in separately.

---

## 3. The Design System

The design system is built entirely on CSS custom properties (variables) defined in `web/src/styles/themes.css`. Three themes are defined using the `[data-theme]` attribute selector on `<html>`. The active theme is set by `document.documentElement.setAttribute('data-theme', theme)` in `ThemeContext.jsx`.

### Backgrounds

| Variable | Obsidian | Cream | Extension |
|----------|----------|-------|-----------|
| `--bg-primary` | `#000000` (pure black) | `#faf8f3` (warm white) | `#ffffff` (white) |
| `--bg-surface` | `#0a0a0a` (near-black) | `#f5f0e8` (warm beige) | `#f7f7f7` (light grey) |
| `--bg-card` | `#111111` (dark card) | `#ffffff` (white card) | `#ffffff` (white) |
| `--bg-overlay` | `rgba(0,0,0,0.85)` | `rgba(250,248,243,0.92)` | `rgba(0,0,0,0.50)` |

`--bg-primary` is the page background. `--bg-surface` is one step lighter — used for sections, sidebars, or inset panels. `--bg-card` is the foreground surface for cards and modals. `--bg-overlay` is for modal backdrops.

### Text

| Variable | Obsidian | Cream | Extension |
|----------|----------|-------|-----------|
| `--text-primary` | `#ffffff` | `#1a1814` (warm near-black) | `#111111` |
| `--text-secondary` | `rgba(255,255,255,0.55)` | `#6b6560` (warm grey) | `#555555` |
| `--text-muted` | `rgba(255,255,255,0.48)` | `#b5b0a8` (light warm grey) | `#999999` |
| `--text-inverse` | `#000000` | `#ffffff` | `#ffffff` |

Use `--text-primary` for body copy, headings, and anything that must be fully readable. Use `--text-secondary` for supporting information. Use `--text-muted` for hints, placeholders, and metadata. Use `--text-inverse` for text sitting on top of an accent-coloured button or badge (white text on the amber/purple button).

### Borders

| Variable | Obsidian | Cream | Extension |
|----------|----------|-------|-----------|
| `--border-subtle` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | `#eeeeee` |
| `--border-card` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.09)` | `#e5e5e5` |
| `--border-strong` | `rgba(255,255,255,0.20)` | `rgba(0,0,0,0.18)` | `#cccccc` |

On dark backgrounds (Obsidian), borders carry the visual weight that shadows carry on light backgrounds. This is why `--shadow-card` is `none` in Obsidian — the border does the same job.

### Accent

| Variable | Obsidian | Cream | Extension |
|----------|----------|-------|-----------|
| `--accent` | `#a78bfa` (soft purple) | `#c17f3a` (amber/caramel) | `#4f46e5` (indigo) |
| `--accent-hover` | `#c4b5fd` (lighter purple) | `#a06830` (darker amber) | `#4338ca` (darker indigo) |
| `--accent-subtle` | `rgba(167,139,250,0.12)` | `rgba(193,127,58,0.10)` | `rgba(79,70,229,0.08)` |
| `--accent-focus` | `rgba(167,139,250,0.40)` | `rgba(193,127,58,0.35)` | `rgba(79,70,229,0.35)` |

`--accent` is the primary interactive colour: buttons, links, active states. `--accent-hover` is used for `:hover` state. `--accent-subtle` is a very light tint for backgrounds on selected/active elements. `--accent-focus` is the focus ring colour (`:focus-visible` outline).

### Semantic colours (status/signal)

| Variable | Obsidian | Cream | Extension | Meaning |
|----------|----------|-------|-----------|---------|
| `--color-high` | `#34d399` (bright green) | `#5a8a62` (muted green) | `#16a34a` | Good, positive, high match |
| `--color-mid` | `#fbbf24` (amber) | `#c17f3a` (same as accent) | `#d97706` | Moderate, warning |
| `--color-low` | `#f87171` (coral red) | `#b85450` (muted red) | `#dc2626` | Bad, low match, risk |
| `--color-high-subtle` | tint of high | tint of high | tint of high | Background for positive badges |
| `--color-mid-subtle` | tint of mid | tint of mid | tint of mid | Background for warning badges |
| `--color-low-subtle` | tint of low | tint of low | tint of low | Background for risk badges |

These map directly to the ghost score labels: `high_risk` → `--color-low`, `moderate_risk` → `--color-mid`, `low_risk` → `--color-high`. Also used for ATS score colouring.

### Typography

| Variable | All themes |
|----------|-----------|
| `--font-heading` | `'Playfair Display', Georgia, serif` (all themes except extension) |
| `--font-body` | `'Inter', system-ui, sans-serif` |

The extension theme uses `'Inter', system-ui, sans-serif` for `--font-heading` too — the serif heading font is dropped in favour of consistency in the compact popup UI.

### Motion

| Variable | Obsidian/Cream | Extension |
|----------|----------------|-----------|
| `--duration-fast` | `200ms` | `150ms` |
| `--duration-base` | `350ms` | `150ms` |
| `--ease-base` | `cubic-bezier(0.4, 0, 0.2, 1)` | same |

The extension theme halves the animation duration — the popup is small and transient, and slower animations would feel sluggish in that context.

### Spacing

Identical across all three themes:

| Variable | Value |
|----------|-------|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `24px` |
| `--space-6` | `32px` |
| `--space-7` | `48px` |
| `--space-8` | `64px` |

### Radius

Identical across all three themes:

| Variable | Value |
|----------|-------|
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |
| `--radius-lg` | `16px` |

### Z-index

Identical across all three themes:

| Variable | Value | Use |
|----------|-------|-----|
| `--z-dropdown` | `100` | Dropdowns, autocomplete menus |
| `--z-modal` | `200` | Modal dialogs |
| `--z-toast` | `300` | Toast notifications (above everything) |

### Shadows

Obsidian: `--shadow-card` and `--shadow-card-hover` are both `none`. On pure black backgrounds, a shadow would be invisible — borders carry the elevation signal instead.

Cream: the shadow colours are derived from `#1a1814` (the text colour), not from cold grey. This gives cards a warm shadow that matches the palette instead of the standard blue-grey web shadows.

Extension: a single-layer shadow, lighter than cream — appropriate for a compact popup.

---

### What Obsidian vs Cream looks like

**Obsidian:** Pure black page (`#000000`), dark cards (`#111111`), white text, purple interactive elements. No card shadows — the `rgba(255,255,255,0.10)` border defines card edges. Green/amber/red status colours are bright and saturated. Serif headings in Playfair Display. Feels editorial and dark.

**Cream:** Warm off-white page (`#faf8f3`), white cards with subtle warm shadows, near-black text (`#1a1814`), amber/caramel interactive elements. The accent colour (`#c17f3a`) is the same as `--color-mid` in the semantic system. Status colours are more muted. Serif headings. Feels analogue and warm.

### How to switch themes

`ThemeContext.jsx` exports `useTheme()` which returns `{ theme, setTheme }`.

Call `setTheme('obsidian')` or `setTheme('cream')`. The context validates the value against `VALID_THEMES = ['obsidian', 'cream']` — any other string is ignored silently.

The user's preference is saved to `localStorage` under the key `platform-theme`. On next page load, `getInitialTheme()` reads this key and restores the last chosen theme. The default (if nothing is stored or the stored value is invalid) is `'cream'`.

In practice, the Sidebar renders a toggle button that calls:
```js
setTheme(isDark ? 'cream' : 'obsidian')
```
where `isDark = theme === 'obsidian'`. The button icon is a moon (click to go dark) or sun (click to go light), with an accessible `aria-label`.

The `'extension'` theme is set automatically when `window.chrome?.extension` is truthy — it cannot be set by calling `setTheme()`. `setTheme()` contains an early return guard: `if (window.chrome?.extension) return;`.

---

## 4. The Typography Component

All text in the web app should use one of the variants exported from `web/src/components/Typography.jsx` instead of raw HTML elements like `<h1>`, `<p>`, or `<span>`. The reason is that raw HTML elements carry no visual styling contract — two developers independently using `<h3>` would produce different results depending on which CSS happened to apply. Typography components enforce a visual contract: `Heading` always renders with the `t-heading` CSS class, so it looks the same everywhere regardless of context.

### All exported variants

| Export name | CSS class | Default HTML tag | Typical use |
|-------------|-----------|-----------------|-------------|
| `Hero` | `t-hero` | `h1` | One per page, largest heading (landing page hero) |
| `Display` | `t-display` | `h2` | Section titles on marketing or dashboard pages |
| `Heading` | `t-heading` | `h3` | Card titles, modal titles, section headings |
| `Subheading` | `t-subheading` | `h4` | Sub-sections within a card |
| `Body` | `t-body` | `p` | Main body text, paragraphs |
| `Small` | `t-small` | `p` | Supporting body text, smaller than Body |
| `Label` | `t-label` | `span` | Form labels, data labels, chip text |
| `Micro` | `t-micro` | `span` | Tiny metadata, timestamps, badges |

### The `as` prop

Every variant accepts an `as` prop that overrides the default HTML tag while keeping the visual class:

```jsx
// Renders a <div> with class "t-body" instead of a <p>
<Body as="div">Content here</Body>

// Renders a <label> with class "t-label"
<Label as="label" htmlFor="email-input">Email</Label>

// Heading that navigates — renders an <a> with heading styling
<Heading as="a" href="/dashboard">Dashboard</Heading>
```

This matters because the semantic HTML tag and the visual appearance are not always the same. A sidebar link might need `Heading` sizing but should be an `<a>`. A list of stats might need `Small` sizing but should be a `<span>` inside a `<li>`.

### The `color` prop

Every variant also accepts a `color` prop that appends a second CSS class:

| `color` value | Appended class | Variable it targets |
|---------------|----------------|---------------------|
| `secondary` | `t-secondary` | `--text-secondary` |
| `muted` | `t-muted` | `--text-muted` |
| `accent` | `t-accent` | `--accent` |
| `high` | `t-high` | `--color-high` |
| `mid` | `t-mid` | `--color-mid` |
| `low` | `t-low` | `--color-low` |

If no `color` is passed, no colour class is added and the text inherits `--text-primary` from the parent.

Example:
```jsx
<Small color="muted">Posted 3 days ago</Small>
<Label color="high">Match: 87%</Label>
<Micro color="low">High ghost risk</Micro>
```

### Importing

```js
import { Hero, Heading, Body, Label, Small } from '../components/Typography';
```

Individual named imports — import only what you use.

---

## 5. Making an API Call from the Frontend

### How client.js is configured

`web/src/api/client.js` creates and exports a single axios instance:

```js
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  timeout: 10_000,
});
```

All requests go to a single base URL. The path you pass to `client.get('/users/me')` is appended to `baseURL`, producing `http://localhost:3000/users/me` in development.

### How VITE_API_URL works in dev vs production

`import.meta.env.VITE_API_URL` is a Vite build-time environment variable. Vite replaces it with a literal string at build time — it is not a runtime fetch.

**In development:**
Run `npm run dev` without any `.env` changes. `VITE_API_URL` is not set, so the `?? 'http://localhost:3000'` fallback applies. The axios client sends requests to `http://localhost:3000` — the gateway container.

**In production:**
The deploy script runs:
```bash
VITE_API_URL=/api npm run build
```
The built JS files contain the literal string `/api` as the base URL. When a request goes to `/api/users/me`, the browser sends it to the same domain (`your-domain.com`). Caddy intercepts `/api/*`, strips the `/api` prefix, and reverse-proxies to `localhost:3000` (the gateway). The gateway sees `/users/me` — no `/api` prefix — which is exactly what it expects.

This is why a relative URL (`/api`) works: Caddy and the web app are served from the same domain.

### Importing the client

From anywhere inside `web/src/`:
```js
import client from '../api/client';   // from a component
import client from '../../api/client'; // from a nested component
```

The path depends on where your file is relative to `web/src/api/client.js`.

### Concrete example: fetching data with loading and error states

```jsx
import { useState, useEffect } from 'react';
import client from '../api/client';
import { Heading, Body, Small } from '../components/Typography';

export default function InsightsPage() {
  const [insights, setInsights] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    client.get('/insights')
      .then(res => {
        // The gateway wraps all responses: { status: 'success', data: { ... } }
        setInsights(res.data.data.insights ?? []);
      })
      .catch(err => {
        // err.response?.data?.message is the API's error message (if the server responded)
        // err.message is the axios error message (timeout, network failure, etc.)
        setError(err.response?.data?.message ?? err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // empty array = run once on mount

  if (loading) return <Body color="muted">Loading…</Body>;
  if (error)   return <Body color="low">Error: {error}</Body>;

  return (
    <div>
      <Heading>Your insights</Heading>
      {insights.map(insight => (
        <div key={insight.id}>
          <Small>{insight.headline}</Small>
        </div>
      ))}
    </div>
  );
}
```

Key points in this pattern:
- The axios client is used directly in a `useEffect` — no wrapper library needed.
- The response body shape from the gateway is always `{ status: 'success' | 'error', data: { ... } }`. Your actual data is one level down: `res.data.data`.
- The `Authorization` header is added automatically by the client interceptor. You never add it manually in a component.
- The `loading` flag prevents showing broken empty state before the request completes.
- The `error` flag surfaces the server's human-readable error message, or the axios error (e.g. `"timeout of 10000ms exceeded"` for a slow request).

---

## 6. The Chrome Extension

The extension has three parts. They cannot share code directly — they run in isolated JavaScript contexts and communicate via message passing.

### Part 1: Background service worker (`extension/src/background/index.js`)

This is the brain of the extension. It runs persistently in the background (Chrome Manifest V3 service worker), survives tab navigation, and is the only part that can call the API.

**What it does:**
- Stores the JWT in `chrome.storage.local` under the key `auth_token`
- Caches the user profile in `chrome.storage.local` under `user_profile` for 24 hours (refreshed on the first autofill after the cache expires — `PROFILE_CACHE_MS = 24 * 60 * 60 * 1000`)
- Makes all API calls: `GET /users/me` (profile), `POST /applications/score` (ATS score), `GET /jobs/ghost-score` (ghost risk), `POST /applications` (log an application)

**Messages it handles:**

| Message type | Sender | What happens |
|-------------|--------|-------------|
| `GET_PAGE_STATE` | Popup | Asks the content script for the page's job form state, then fetches the ATS score and appends it |
| `START_AUTOFILL` | Popup | Fetches (or restores from cache) the user profile, then sends it to the content script to fill the form |
| `LOG_APPLICATION` | Popup | POSTs the job details to `POST /applications` |
| `GBM_SET_TOKEN` | Content script (relayed from web app) | Stores the JWT and clears the cached profile |
| `REQUEST_GHOST_SCORE` | Content script | Fetches `GET /jobs/ghost-score`, sends the result back to both the content script and any open popup |

`API_BASE` is loaded at the top of this file via `importScripts('../config.js')`. This is the only file in the extension that needs the API URL — the popup reads it directly from config.js via a `<script>` tag in its HTML.

### Part 2: Popup (`extension/src/popup/popup.js`)

The popup is the small window that appears when the user clicks the extension icon. It is plain HTML + CSS + JS — no framework.

**Four states (only one is visible at a time):**

1. **`state-auth`**: No JWT found in storage. Shows "Sign in to GBM" button that opens a new tab to `WEB_APP_URL`. Shown immediately without an API call.

2. **`state-idle`**: Authenticated, but the current tab is not a job application page. Shows "Currently on: domain.com". The domain is extracted from the active tab's URL.

3. **`state-job`**: Current tab has a detected job application form. Shows:
   - Company name and role title (extracted from JSON-LD, OG meta, or page title)
   - ATS score ring (0–100 gauge, colour-coded green/amber/red)
   - Ghost risk indicator (dot + label + "Why?" expandable reasons list)
   - "Generate tailored cover letter" button → calls `POST /agent/generate-cover-letter`, fills the cover letter field on the page
   - "+ Add contact details" expandable section for outreach
   - "Draft outreach message" button → calls `POST /agent/generate-outreach`, displays the result in a copyable block
   - "Autofill form" button → triggers the fill flow, transitions to `state-filling`
   - "Log as Applied" button → sends `LOG_APPLICATION` to background

4. **`state-filling`**: Auto-fill is in progress. Shows a progress bar and a list of fields being filled (○ → … → ✓). Updates live as `FILL_PROGRESS` messages arrive from the content script.

**Model text extraction in the popup:**

The popup's `extractModelText(result)` function handles both Tier 2 and Tier 3 response shapes:
```js
result.data?.choices?.[0]?.message?.content  // Tier 2 (Groq / OpenAI-compatible)
result.data?.content?.[0]?.text              // Tier 3 (Anthropic)
```
This means the popup works regardless of which AI provider is configured.

### Part 3: Content script (`extension/src/content/index.js`)

Injected by Chrome into every HTTPS page and into `http://localhost:5173/*`. Runs in the context of the web page's DOM but in an isolated JS scope — it cannot access the page's JavaScript variables.

**What it does on every page load:**

1. `detectApplicationForm()` — scans `<form>` elements for one that looks like a job application: 3+ visible inputs, and either an "Apply / Submit" button or an email input. Returns the first match, or null if none found.

2. `classifyFormFields(form)` — classifies each input in the detected form into one of: `FIRST_NAME`, `LAST_NAME`, `FULL_NAME`, `EMAIL`, `PHONE`, `LINKEDIN`, `WEBSITE`, `LOCATION`, `COVER_LETTER`, `RESUME`, or `UNKNOWN`. Classification uses a priority-ordered set of rules that check the element's `type`, `autocomplete`, `name`, `id`, `placeholder`, and associated `<label>` text. `UNKNOWN` fields are excluded from the autofill list.

3. `extractJobMeta()` — extracts company name and role title. Tries JSON-LD structured data (`<script type="application/ld+json">`) first, then OG meta tags, then the page `<title>`. Most major job boards (LinkedIn, Greenhouse, Lever) include JSON-LD.

4. `extractJobText()` — pulls the visible text of the job description. Tries common CSS selectors (`[class*="job-description"]`, `article`, `main`) before falling back to the full body text. Capped at 5,000 characters.

5. `hashJD(jdText)` — computes SHA-256 of the trimmed, lowercased JD text and returns the first 16 hex characters. Identical algorithm to `services/jobs/src/utils/fingerprint.js`, so the extension and the server agree on the same fingerprint hash.

6. Sends `REQUEST_GHOST_SCORE` to the background, which fetches the score asynchronously and sends back `GHOST_SCORE_RESULT`. The content script caches this in `currentGhostScore`.

**Token relay (only on the web app tab):**

The content script runs on `http://localhost:5173/*` (or the production web app URL if updated in the manifest). After the user logs in, `AuthContext` calls `window.postMessage({ type: 'GBM_SET_TOKEN', token }, origin)`. The content script catches this:

```js
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'GBM_SET_TOKEN' && event.data?.token) {
    chrome.runtime.sendMessage({ type: 'GBM_SET_TOKEN', token: event.data.token });
  }
});
```

The background then stores the JWT. On all other sites this listener is present but effectively does nothing — `GBM_SET_TOKEN` messages will never originate from a job board.

### How config.js controls the API base URL

`extension/src/config.js` defines two plain JS `const` declarations:

```js
const API_BASE    = 'http://localhost:3000';
const WEB_APP_URL = 'http://localhost:5173';
```

These are loaded before other scripts via:
- `importScripts('../config.js')` in the background service worker
- A `<script src="../config.js">` tag before `popup.js` in the popup HTML

Because they're declared with `const` in the global scope, both consuming files can read `API_BASE` and `WEB_APP_URL` directly without any import statement.

### Steps to package the extension for production

1. **In `extension/src/config.js`:** Replace the two const values:
   ```js
   const API_BASE    = 'https://your-domain.com';   // production gateway (through Caddy)
   const WEB_APP_URL = 'https://your-domain.com';   // same domain if web + API share one
   ```
   Note: the gateway is reachable as `https://your-domain.com/api/*` through Caddy — but since the extension strips `/api` by calling the gateway path directly (e.g. `/users/me`, not `/api/users/me`), you should either use a subdomain URL that goes directly to port 3000, or use the full Caddy URL and update the gateway paths. Check the exact routing on your production server.

2. **In `extension/manifest.json`:** Two fields must be updated:
   - `externally_connectable.matches`: Replace `"http://localhost:5173/*"` with your production web app URL + `/*` so the web app can send `GBM_SET_TOKEN` to the extension after login.
   - `host_permissions`: Remove `"http://localhost/*"` (dev-only) or replace it with your production gateway domain.

3. **Zip the `extension/` directory:** The zip must contain `manifest.json` at the root (not inside a subdirectory). On Windows: select all files inside `extension/`, right-click → Send to → Compressed folder, or use a terminal:
   ```bash
   cd extension
   zip -r ../gbm-extension.zip .
   ```

4. **Upload** the zip to the Chrome Web Store Developer Dashboard.

---

## 7. The Mobile App

The mobile API client is in `mobile/src/api/client.js`.

```js
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const client = axios.create({ baseURL: API_BASE, timeout: 10_000 });

client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

The structure mirrors the web client, with two differences:
1. The environment variable is `EXPO_PUBLIC_API_URL` (Expo's convention, not Vite's `VITE_`). Variables prefixed with `EXPO_PUBLIC_` are inlined at build time and accessible via `process.env`.
2. The interceptor is `async` because `getToken()` is an async function — it reads from Expo's `SecureStore` (or `AsyncStorage`), both of which are async unlike the browser's synchronous `localStorage`.

### Setting EXPO_PUBLIC_API_URL for local dev vs production

**Emulator (iOS Simulator or Android Emulator) — localhost works:**

The emulator runs a virtual device on your development machine. `localhost` inside the emulator resolves to the development machine's loopback adapter. So you can leave `EXPO_PUBLIC_API_URL` unset and the fallback `http://localhost:3000` works. Start the gateway on port 3000 and the emulator can reach it.

**Physical device — localhost does NOT work:**

A real phone on your Wi-Fi network cannot resolve `localhost` to your laptop — it would try to connect to itself. You need to use your machine's LAN IP address:

1. Find your machine's LAN IP (on macOS: `ifconfig | grep "inet "`, on Windows: `ipconfig` → look for IPv4 address, e.g. `192.168.1.42`).
2. Create a `.env` file in the `mobile/` directory:
   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.42:3000
   ```
3. Restart Expo (`npx expo start --clear` to clear the cache).
4. The phone and the laptop must be on the same Wi-Fi network. If your router blocks device-to-device traffic (common on guest networks), this won't work — use a regular home/office network.

**Production build:**

Set `EXPO_PUBLIC_API_URL=https://your-domain.com` in the build environment (either `.env.production` in the mobile directory, or as an environment variable in your CI/CD pipeline or EAS Build configuration). The built app will contain this URL as a literal string — it cannot be changed after the app is published without a new build.

---

## 8. How to Add a New Page

The full steps, in order. The example adds an "Analytics" page at `/dashboard/analytics`.

---

### Step 1: Create the component file

Create `web/src/pages/AnalyticsPage.jsx`:

```jsx
import { useState, useEffect } from 'react';
import client from '../api/client';
import { Heading, Body } from '../components/Typography';

export default function AnalyticsPage() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    client.get('/some-endpoint')
      .then(res  => setData(res.data.data))
      .catch(err => setError(err.response?.data?.message ?? err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Body color="muted">Loading…</Body>;
  if (error)   return <Body color="low">Error: {error}</Body>;

  return (
    <div>
      <Heading>Analytics</Heading>
      {/* render data here */}
    </div>
  );
}
```

Rules to follow:
- Use Typography components (`Heading`, `Body`, etc.) — not raw `<h3>` or `<p>`.
- Use `var(--bg-card)`, `var(--text-primary)`, `var(--accent)` etc. in any inline styles or CSS module styles — not hardcoded hex colours.
- Use `var(--space-*)` for margins and padding, `var(--radius-*)` for border-radius.

---

### Step 2: Add the lazy import in App.jsx

In `web/src/App.jsx`, add one line with the other `lazy()` imports (lines 9–16):

```js
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
```

Place it alphabetically or at the end of the import block — order doesn't matter for lazy imports.

---

### Step 3: Add the route in App.jsx

Inside the `/dashboard` `<Route>` block (currently lines 44–56 in `App.jsx`), add a new child route:

```jsx
<Route path="analytics" element={<Suspense fallback={null}><AnalyticsPage /></Suspense>} />
```

The full path becomes `/dashboard/analytics`. The `path` attribute is relative — don't add a leading slash.

The complete dashboard block now looks like:

```jsx
<Route path="/dashboard" element={
  <ProtectedRoute>
    <PageTransition>
      <Suspense fallback={null}><DashboardLayout /></Suspense>
    </PageTransition>
  </ProtectedRoute>
}>
  <Route index element={<Suspense fallback={null}><DashboardPage /></Suspense>} />
  <Route path="tracker"       element={<Suspense fallback={null}><KanbanPage /></Suspense>} />
  <Route path="insights"      element={<Suspense fallback={null}><InsightsPage /></Suspense>} />
  <Route path="profile"       element={<Suspense fallback={null}><ProfilePage /></Suspense>} />
  <Route path="opportunities" element={<Suspense fallback={null}><OpportunitiesPage /></Suspense>} />
  <Route path="analytics"     element={<Suspense fallback={null}><AnalyticsPage /></Suspense>} />
</Route>
```

---

### Step 4: Add a sidebar link in Sidebar.jsx

In `web/src/components/dashboard/Sidebar.jsx`, the `NAV_ITEMS` array (lines 6–12) controls what appears in the sidebar. Add one entry:

```js
const NAV_ITEMS = [
  { to: '/dashboard',               label: 'Dashboard',     end: true  },
  { to: '/dashboard/tracker',        label: 'Tracker',       end: false },
  { to: '/dashboard/insights',      label: 'Insights',      end: false },
  { to: '/dashboard/profile',       label: 'Profile',       end: false },
  { to: '/dashboard/opportunities', label: 'Opportunities', end: false },
  { to: '/dashboard/analytics',     label: 'Analytics',     end: false },  // ← new
];
```

The `end: false` means the NavLink is marked "active" when the URL starts with `/dashboard/analytics` — not just an exact match. Only the Dashboard index entry uses `end: true` because its `to` is `/dashboard`, which would otherwise match every dashboard sub-route.

The link appears automatically in the sidebar — no other change to `Sidebar.jsx` is needed. The `NavLink` in the render loop picks up your new entry and applies the active style when the user is on `/dashboard/analytics`.

---

### Step 5: Connect to an API call

The page component from Step 1 already shows the pattern. To expand on it:

- Import `client` from `'../api/client'` (adjust the relative path based on where your file is).
- The auth token is added automatically — you don't need to manage it.
- The `useEffect` with an empty dependency array `[]` runs once when the component mounts (i.e., when the route is first visited). To reload on a user action, call the fetch function directly from an event handler instead.
- API response shape: `res.data` is `{ status: 'success', data: { ... } }`. Your data is in `res.data.data`.
- Error shape when the server responds: `err.response.data` is `{ status: 'error', message: '...' }`. Your message is in `err.response.data.message`.
- Error shape when there is no response (timeout, network down): `err.message` is a plain string like `"timeout of 10000ms exceeded"`.
