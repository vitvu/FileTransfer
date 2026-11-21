// FileTransfer signaling server (Cloudflare Worker + Durable Object).
//
// This server only relays small WebRTC handshake messages (SDP / ICE) between peers that are
// in the same "room". File contents never pass through it. Nothing is persisted except a
// per-room "active" flag, which is deleted after the room has been empty for 10 minutes.
import { DurableObject } from "cloudflare:workers";

const ROOM_IDLE_MS = 10 * 60 * 1000; // an empty room expires after 10 minutes
const LAN_MAX = 20; // max devices in one LAN group
const ROOM_MAX = 2; // max peers in a code room
const MAX_MSG = 16 * 1024; // signaling messages are a few KB at most

// ---------- helpers ----------

// IPv6: devices on one LAN have different public addresses but share the /64 prefix -> group by /64
function lanKey(ip) {
  if (!ip) return "local";
  if (!ip.includes(":")) return ip;
  let [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return "v6:" + groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

function originAllowed(origin, url, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    return allowed.includes(origin) || new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

// Coarse device info (OS, form factor, browser, model) shown to the other peer, e.g. "iPhone · Safari".
// Everything is validated here: only whitelisted values or a short sanitized model string get through.
const DEV_OS = new Set(["ios", "android", "windows", "mac", "linux", "chromeos", "other"]);
const DEV_TYPE = new Set(["phone", "tablet", "desktop"]);
const DEV_BROWSER = new Set(["chrome", "safari", "firefox", "edge", "opera", "samsung", "other"]);
const DEV_KEYS = ["os", "type", "br", "model", "bv", "ov", "bid"];

function parseDevice(p) {
  const os = p.get("os");
  const type = p.get("type");
  const br = p.get("br");
  return {
    os: DEV_OS.has(os) ? os : "other",
    type: DEV_TYPE.has(type) ? type : "desktop",
    browser: DEV_BROWSER.has(br) ? br : "other",
    model: String(p.get("model") || "").replace(/[^\w .+()-]/g, "").trim().slice(0, 24),
    bv: String(p.get("bv") || "").replace(/[^\d.]/g, "").slice(0, 10), // browser version
    ov: String(p.get("ov") || "").replace(/[^\w.]/g, "").slice(0, 10), // OS version
    bid: /^[\w-]{8,32}$/.test(p.get("bid") || "") ? p.get("bid") : "", // per-browser id, lets a browser hide its own other tabs
  };
}

function parseNet(p) {
  const ip = String(p.get("ip") || "");
  return {
    ip: /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "",
    isp: String(p.get("isp") || "").replace(/[^\p{L}\p{N} .,&()'-]/gu, "").slice(0, 40),
    cc: /^[A-Z]{2}$/.test(p.get("cc") || "") ? p.get("cc") : "",
  };
}

function randomCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

// Browsers cannot read the HTTP status of a failed WebSocket handshake, so we accept the socket
// and immediately close it with an application-specific close code (4404 / 4423 / 4500).
function refuse(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

const ANIMALS = ["Fox", "Cat", "Dog", "Tiger", "Bear", "Rabbit", "Wolf", "Owl", "Deer", "Turtle", "Fish", "Frog"];
const COLORS = ["Blue", "Red", "Gold", "Purple", "Orange", "Pink", "Brown", "Teal", "Green", "Silver"];
const pick = (a) => a[crypto.getRandomValues(new Uint32Array(1))[0] % a.length];

// TURN relay credentials. Peers on different networks often cannot connect directly (mobile carriers,
// corporate NAT), so the data is relayed (still end-to-end encrypted by DTLS). Relay bandwidth is limited and
// shared, so credentials are handed out sparingly: only on request (`?relay=1`, used for code rooms), at most
// once per RELAY_COOLDOWN_MS per client IP, at most RELAY_DAILY_MAX times per day for everyone, and (Cloudflare) they expire
// after RELAY_TTL_S. Configure ONE provider with Worker secrets (never in the repo):
//   Cloudflare Realtime TURN: TURN_KEY_ID, TURN_KEY_API_TOKEN
//   Metered Open Relay:       METERED_APP, METERED_API_KEY (static credential; free plan)
const RELAY_COOLDOWN_MS = 30 * 1000;
const RELAY_DAILY_MAX_DEFAULT = 150;
const RELAY_TTL_S = 10 * 60;
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

const iceResponse = (servers, relay) =>
  new Response(JSON.stringify({ iceServers: servers, relay }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function counter(env, name, query) {
  const r = await env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(`https://rl.internal/rl?${query}`);
  return (await r.json()).why || "ok";
}

async function relayServers(env) {
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: RELAY_TTL_S }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : null;
  }
  if (env.METERED_APP && env.METERED_API_KEY) {
    // Metered's free plan allows a single credential, so this one is static; the limits above are what protects it.
    const r = await fetch(`https://${encodeURIComponent(env.METERED_APP)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`);
    if (!r.ok) return null;
    const list = await r.json();
    return Array.isArray(list) && list.length ? list : null;
  }
  return null;
}

async function iceServers(request, url, env) {
  const origin = request.headers.get("Origin");
  if (origin && !originAllowed(origin, url, env)) return new Response("Forbidden", { status: 403 });
  if (url.searchParams.get("relay") !== "1") return iceResponse(STUN, "off");
  if (!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) && !(env.METERED_APP && env.METERED_API_KEY)) return iceResponse(STUN, "off");
  try {
    // 1) one grant per client IP every 30 s (IPv6 is grouped by /64), 2) a daily cap for everyone
    const ip = lanKey(request.headers.get("CF-Connecting-IP"));
    const cool = env.RELAY_COOLDOWN_MS === undefined ? RELAY_COOLDOWN_MS : Number(env.RELAY_COOLDOWN_MS) || 0; // overridable, for testing
    const per = cool ? await counter(env, "rl:ip:" + ip, `cool=${cool}&ttl=${cool * 2}`) : "ok";
    if (per !== "ok") return iceResponse(STUN, "throttled");
    const day = new Date().toISOString().slice(0, 10);
    const max = Number(env.RELAY_DAILY_MAX) || RELAY_DAILY_MAX_DEFAULT;
    const all = await counter(env, "rl:day:" + day, `max=${max}&ttl=${26 * 3600 * 1000}`);
    if (all !== "ok") return iceResponse(STUN, "full");
    const servers = await relayServers(env);
    return servers ? iceResponse([...STUN, ...servers], "ok") : iceResponse(STUN, "off");
  } catch {
    return iceResponse(STUN, "off");
  }
}

// ---------- Worker (entry point) ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ice") return iceServers(request, url, env);
    if (url.pathname !== "/ws"|| request.headers.get("Upgrade") !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    // Only the configured web origins (or same-origin, for local dev) may use this signaling server.
    const origin = request.headers.get("Origin");
    if (origin && !originAllowed(origin, url, env)) return new Response("Forbidden", { status: 403 });

    const kind = url.searchParams.get("kind");
    if (kind !== "lan" && kind !== "create" && kind !== "join") return new Response("Bad request", { status: 400 });

    // Per-client rate limits (Workers Rate Limiting bindings, see wrangler.toml). Joining a room is
    // limited much harder than the rest, which makes guessing 6-digit codes impractical.
    // The bindings are optional so local development and tests run without them.
    const limiter = kind === "join" ? env.JOIN_LIMITER : env.WS_LIMITER;
    if (limiter) {
      const { success } = await limiter.limit({ key: lanKey(request.headers.get("CF-Connecting-IP")) });
      if (!success) return refuse(4429, "ratelimited");
    }

    const forward = (name, params) => {
      const u = new URL(request.url);
      const q = new URLSearchParams(params);
      for (const k of DEV_KEYS) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k));
      // Network details of this client (from Cloudflare, never from the client). Shown only to the other
      // device of a code room, to help tell devices apart when they are not on the same network.
      q.set("ip", request.headers.get("CF-Connecting-IP") || "");
      q.set("isp", (request.cf && request.cf.asOrganization) || "");
      q.set("cc", (request.cf && request.cf.country) || "");
      u.search = q.toString();
      return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(new Request(u, request));
    };

    if (kind === "lan") {
      const key = lanKey(request.headers.get("CF-Connecting-IP"));
      return forward("lan:" + key, { kind: "lan" });
    }

    if (kind === "create") {
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        const res = await forward("room:" + code, { kind: "create", code });
        if (res.status !== 409) return res; // 409 = code collision, try another code
      }
      return refuse(4500, "busy");
    }

    if (kind === "join") {
      const code = url.searchParams.get("code") || "";
      if (!/^\d{6}$/.test(code)) return refuse(4404, "notfound");
      return forward("room:" + code, { kind: "join", code });
    }

    return new Response("Bad request", { status: 400 }); // unreachable: kind was validated above
  },
};

// ---------- Durable Object: one room = one DO, using the WebSocket Hibernation API ----------

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  live(except) {
    return this.ctx.getWebSockets().filter((s) => s !== except && s.readyState === 1);
  }

  // Tiny counter used by the relay limits above (one DO per client IP / per day). Expires through the alarm.
  async counter(p) {
    const cool = Number(p.get("cool")) || 0;
    const max = Number(p.get("max")) || 0;
    const ttl = Number(p.get("ttl")) || 60000;
    const now = Date.now();
    const last = (await this.ctx.storage.get("last")) || 0;
    const n = (await this.ctx.storage.get("n")) || 0;
    const no = (why) => new Response(JSON.stringify({ ok: false, why }));
    if (cool && now - last < cool) return no("throttled");
    if (max && n >= max) return no("full");
    await this.ctx.storage.put({ last: now, n: n + 1 });
    await this.ctx.storage.setAlarm(now + ttl);
    return new Response(JSON.stringify({ ok: true }));
  }

  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/rl") return this.counter(u.searchParams);
    const p = u.searchParams;
    const kind = p.get("kind");
    const isRoom = kind !== "lan";

    if (kind === "create") {
      // 409 lets the Worker retry with another code
      if ((await this.ctx.storage.get("active")) || this.live().length) {
        return new Response("exists", { status: 409 });
      }
      await this.ctx.storage.put("active", true);
    } else if (kind === "join") {
      if (!(await this.ctx.storage.get("active"))) return refuse(4404, "notfound");
    }

    const peers = this.live();
    if (peers.length >= (isRoom ? ROOM_MAX : LAN_MAX)) return refuse(4423, "full");

    const [client, server] = Object.values(new WebSocketPair());
    const me = { id: crypto.randomUUID().slice(0, 8), name: `${pick(COLORS)} ${pick(ANIMALS)}`, room: isRoom, dev: parseDevice(p), net: isRoom ? parseNet(p) : null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);
    if (isRoom) await this.ctx.storage.deleteAlarm();

    server.send(
      JSON.stringify({
        t: "hello",
        id: me.id,
        name: me.name,
        code: p.get("code") || undefined,
        peers: peers.map((s) => {
          const a = s.deserializeAttachment();
          return { id: a.id, name: a.name, dev: a.dev, net: a.net || undefined };
        }),
      })
    );
    const joinMsg = JSON.stringify({ t: "join", peer: { id: me.id, name: me.name, dev: me.dev, net: me.net || undefined } });
    for (const s of peers) s.send(joinMsg);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG) return;
    let m;
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    if (m.t !== "sig" || typeof m.to !== "string") return;
    const me = ws.deserializeAttachment();
    for (const s of this.live(ws)) {
      if (s.deserializeAttachment().id === m.to) {
        s.send(JSON.stringify({ t: "sig", from: me.id, data: m.data }));
        break;
      }
    }
  }

  async webSocketClose(ws) {
    await this.gone(ws);
    try {
      ws.close(1000, "bye");
    } catch {}
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const me = ws.deserializeAttachment();
    const rest = this.live(ws);
    const msg = JSON.stringify({ t: "leave", id: me.id });
    for (const s of rest) s.send(msg);
    // Room is now empty: expire it after 10 minutes (the code becomes invalid)
    if (me.room && rest.length === 0) await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS);
  }

  async alarm() {
    if (this.live().length === 0) await this.ctx.storage.deleteAll();
  }
}
