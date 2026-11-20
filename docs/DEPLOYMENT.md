# Deployment guide

FileTransfer runs as **one Cloudflare Worker** that serves the static web app (`public/`) and handles WebRTC signaling on `/ws`. The free plan is enough: static files never invoke the Worker, and signaling uses a Durable Object (SQLite-backed, free tier).

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). No credit card.

## 1. Deploy

### Option A: your own domain (recommended)

The domain's DNS must be managed by Cloudflare. Edit [`wrangler.toml`](../wrangler.toml):

```toml
routes = [{ pattern = "files.example.com", custom_domain = true }]
workers_dev = false

[vars]
ALLOWED_ORIGINS = "https://files.example.com"
```

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler creates the DNS record and TLS certificate for you.

> **Tip:** if the first deploy ends with `This Worker does not exist on your account` right after a successful upload, Cloudflare's API has not caught up yet. Wait about 20 seconds and run `npx wrangler triggers deploy`.

### Option B: a free `workers.dev` address

Remove the `routes` line, set `workers_dev = true`, and put the URL that Wrangler prints into `ALLOWED_ORIGINS`. Deploy again.

> The `workers.dev` hostname contains your Cloudflare account subdomain. If you would rather not publish it, use Option A or rename the subdomain in the dashboard.

## 2. Automatic deploys (optional)

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) deploys on every push to `main`. It does nothing until you add two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | API token from the *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | Your account id (dashboard sidebar) |

## 3. Hosting the UI somewhere else (optional)

The files in `public/` work on any static host (Cloudflare Pages, GitHub Pages, Netlify, cPanel). Deploy the Worker as above, add the site's origin to `ALLOWED_ORIGINS`, and set `signalingUrl` in [`public/config.js`](../public/config.js) to `wss://<worker-host>/ws`. cPanel cannot run the signaling server itself, because it does not support WebSocket servers.

## Hardening checklist

- Add a Cloudflare **WAF rate limiting rule** for `/ws` for a hard cap. The Worker's built-in limiter is best effort only.
- Turn off **Web Analytics** for the zone if you do not use it (the page's CSP blocks its script anyway).

## Configuration reference

| Setting | Where | Purpose |
|---------|-------|---------|
| `ALLOWED_ORIGINS` | `wrangler.toml` | Origins allowed to open a signaling connection. The page's own origin is always allowed. |
| `JOIN_LIMITER`, `WS_LIMITER` | `wrangler.toml` | Best-effort rate limits per client IP: 10 room joins / 60 connections per minute. |
| `signalingUrl` | `public/config.js` | Signaling WebSocket URL. Empty means "same origin". |
| `MAX_SIZE`, `CHUNK`, `HIGH`, `LOW`, `STREAM_MIN` | `public/app.js` | File size limit, flow-control tuning, and the size above which Chrome/Edge stream to disk (200 MB). |
| `ICE` | `public/app.js` | STUN and TURN servers. |
| `ROOM_IDLE_MS`, `ROOM_MAX`, `LAN_MAX` | `src/worker.js` | Room expiry (10 min), room size (2), LAN group size (20). |
| Translations | `public/i18n.js` | English and Vietnamese strings. Add a language by adding a dictionary. |
| Security headers | `public/_headers` | CSP, HSTS and friends for the static site. |

## Project structure

```
public/            Static web app: index.html, app.js, modal.js, device.js, i18n.js, theme.js, style.css, config.js, _headers
src/worker.js      Signaling Worker and Room Durable Object
test/              Signaling integration tests
docs/              This guide and the README screenshots
wrangler.toml      Production deployment
wrangler.dev.toml  Local development (UI and Worker on one origin)
.github/           CI, deploy workflow, issue and PR templates
```
