# FileTransfer

**Peer-to-peer file transfer in the browser.** Send files of up to 1 GB directly between two devices: no account, no install, no upload to a server. Find devices on your local network automatically (like Snapdrop), or connect from anywhere with a 6-digit room code.

**Live app:** https://vitvu.github.io/FileTransfer/

[![CI](https://github.com/vitvu/FileTransfer/actions/workflows/ci.yml/badge.svg)](https://github.com/vitvu/FileTransfer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Features

- **Direct transfer.** File data goes straight from one browser to the other over a WebRTC data channel (DTLS-encrypted). It never touches a server.
- **Two ways to connect.**
  - *Nearby devices*: open the page on two devices on the same network and they see each other.
  - *Room code*: create a room, share the 6-digit code, and connect from different networks.
- **Large files.** Up to 1 GB per file, sent unmodified (no archives, no splitting visible to you). On Chrome and Edge the receiver streams straight to disk, so memory use stays flat.
- **Flow-controlled.** Sender-side backpressure and read-ahead keep the connection saturated without exhausting memory.
- **Consent first.** The receiver explicitly accepts or declines every file. Either side can cancel at any time.
- **Static front end.** The UI is plain HTML/CSS/JS with no build step and no dependencies. Free to host on GitHub Pages.
- **Tiny, stateless backend.** One Cloudflare Worker relays connection handshakes only. It fits comfortably in Cloudflare's free tier.
- **Bilingual UI.** English and Vietnamese, picked from the browser language.

## How it works

```
        Device A                                     Device B
           │   1. open WebSocket (signaling only)       │
           ├──────────────►  Cloudflare Worker  ◄───────┤
           │                 (same room / same LAN)     │
           │   2. exchange WebRTC offer/answer + ICE    │
           │   3. STUN lookup of public address         │
           │                                            │
           ╞════════ 4. direct encrypted data channel ══╡
                       file bytes flow here only
```

1. Both devices open a WebSocket to the signaling Worker. The Worker puts them in the same Durable Object, either a **LAN group** (devices that share a public IP address) or a **room** (devices that entered the same 6-digit code).
2. The Worker relays small handshake messages (SDP and ICE candidates, a few KB in total) between them.
3. The browsers use public STUN servers to discover how to reach each other and open a direct `RTCDataChannel`.
4. The sender streams the file in 64 KB messages with backpressure. The receiver writes it to disk (File System Access API) or, on browsers without it, buffers it in memory and triggers a download.

After step 3 the Worker is no longer involved in the transfer.

### Components

| Part | Where it runs | What it does |
|------|---------------|--------------|
| `public/` | GitHub Pages (any static host) | The web app. No server code. |
| `src/worker.js` | Cloudflare Worker + Durable Object | WebSocket signaling and room bookkeeping. |

## Quick start (local)

Requirements: [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/vitvu/FileTransfer.git
cd FileTransfer
npm install
npm run dev
```

Open http://localhost:8787 in two browser windows. They find each other as "nearby devices". `npm run dev` serves the UI and the signaling server from one origin, so no configuration is needed.

To try it from a phone or another computer, WebRTC and the File System Access API require a secure context (HTTPS or `localhost`). Deploy the app (below) rather than using a plain `http://192.168.x.x` address.

Run the signaling tests while the dev server is running:

```bash
npm test
```

## Deploy your own

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and a GitHub account. No credit card and no domain are required.

### 1. Deploy the signaling Worker

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler prints the Worker URL, for example `https://filetransfer-signaling.<your-subdomain>.workers.dev`.

Before deploying, set the origin of your front end in [`wrangler.toml`](wrangler.toml). Only listed origins may open a signaling connection:

```toml
[vars]
ALLOWED_ORIGINS = "https://<your-github-username>.github.io"
```

Multiple origins are comma separated. Use the scheme and host only, with no path.

> **Privacy note:** the `workers.dev` hostname includes your Cloudflare account subdomain. If you do not want it to appear in a public repository, attach a custom domain to the Worker instead (Cloudflare dashboard → Workers → your Worker → Settings → Domains & Routes).

### 2. Point the front end at the Worker

Edit [`public/config.js`](public/config.js):

```js
window.FILETRANSFER_CONFIG = {
  signalingUrl: "wss://filetransfer-signaling.<your-subdomain>.workers.dev/ws",
};
```

### 3. Publish the front end on GitHub Pages

1. Push the repository to GitHub.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The [`pages.yml`](.github/workflows/pages.yml) workflow publishes the `public/` directory.

The app is then available at `https://<your-github-username>.github.io/<repo-name>/`.

Any other static host (Cloudflare Pages, Netlify, cPanel, an S3 bucket) works too: upload the contents of `public/` and add its origin to `ALLOWED_ORIGINS`. cPanel hosting cannot run the signaling server itself because it does not support WebSocket servers, which is why the Worker is a separate deployment.

## Configuration

| Setting | File | Purpose |
|---------|------|---------|
| `ALLOWED_ORIGINS` | `wrangler.toml` | Origins allowed to use the signaling server. |
| `signalingUrl` | `public/config.js` | WebSocket URL of the Worker. Empty means "same origin" (local dev). |
| `MAX_SIZE`, `CHUNK`, `HIGH`, `LOW` | `public/app.js` | File size limit and flow-control tuning. |
| `ROOM_IDLE_MS`, `ROOM_MAX`, `LAN_MAX` | `src/worker.js` | Room expiry (10 min), room size (2), LAN group size (20). |
| `ICE` | `public/app.js` | STUN/TURN servers. |

## Privacy and security

- **File contents never reach the Worker or GitHub.** They are sent over an end-to-end encrypted (DTLS) peer connection.
- **What the Worker sees:** your IP address (to group devices on the same network), a random per-connection id and display name, and the WebRTC handshake messages it relays. None of it is written to storage or logs. The only persisted data is a boolean "room is active" flag, deleted 10 minutes after a room becomes empty. Observability is disabled in `wrangler.toml`.
- **What other parties see:** WebRTC inherently exposes your IP address to the device you connect to, and to the STUN servers used for discovery (Cloudflare and Google by default). GitHub Pages and Cloudflare keep their own infrastructure logs.
- **No tracking.** No analytics, no cookies, no `localStorage`, no third-party scripts. A strict Content Security Policy is set on the page.
- **Room codes are not secrets.** A 6-digit code is a convenience, not authentication. Rooms hold at most two devices, expire quickly, and the receiver must approve each file, but do not rely on the code to protect sensitive transfers. Add a Cloudflare WAF rate-limiting rule for `/ws` to make guessing impractical.
- **Origin allow-list.** The Worker rejects WebSocket connections from origins that are not in `ALLOWED_ORIGINS`.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Browser support

| Browser | Send | Receive |
|---------|------|---------|
| Chrome / Edge (desktop) | Yes | Yes, streamed to disk |
| Firefox, Safari | Yes | Yes, buffered in memory, then downloaded |
| Mobile browsers | Yes | Yes, buffered in memory, then downloaded |

## Limitations

- **No TURN relay.** Some networks (symmetric NAT, strict corporate or campus Wi-Fi, some mobile carriers) block direct peer-to-peer connections, and the transfer cannot start there. Devices on the same LAN almost always connect. Adding a TURN server (for example [coturn](https://github.com/coturn/coturn)) to `ICE` in `public/app.js` solves this at the cost of relaying traffic through that server.
- **One file at a time** per pair of devices, and one receiver per sender.
- **1 GB limit** per file. Without disk streaming, the receiving browser holds the file in memory.
- **"Nearby" means "same public IP".** Devices behind different NATs on the same site, or using a VPN or proxy, may not see each other. Use a room code in that case.
- **Throughput depends on the browser and network.** WebRTC data channels are typically slower than raw TCP; expect tens of MB/s on a good local network, not line rate.

## Project structure

```
.
├── public/               Static web app (deployed to GitHub Pages)
│   ├── index.html
│   ├── app.js            WebRTC, file transfer and UI logic
│   ├── i18n.js           English / Vietnamese strings
│   ├── config.js         Runtime configuration (signaling URL)
│   └── style.css
├── src/worker.js         Signaling Worker and Room Durable Object
├── test/                 Signaling integration tests
├── wrangler.toml         Production Worker config
├── wrangler.dev.toml     Local development config (UI + Worker on one origin)
└── .github/workflows/    CI and GitHub Pages deployment
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
