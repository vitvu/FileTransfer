// FileTransfer web client.
// Files travel directly between two browsers over a WebRTC DataChannel. The signaling server
// (a Cloudflare Worker) only relays small handshake messages and never sees file contents.
import { t, applyStatic, getLang, setLang } from "./i18n.js";
import { describeDevice, deviceParams, deviceLabel, deviceIcon } from "./device.js";
import { newKeyPair, deriveKey, RelayChannel } from "./relay.js";
import { openTransfer, makeThumb, validThumb, isTransferOpen, fmt } from "./modal.js";

const MAX_SIZE = 1024 ** 3; // 1 GiB
const CHUNK = 64 * 1024; // size of each DataChannel message
const BLOCK = 1024 * 1024; // read the file from disk in 1 MB blocks (the next block is prefetched)
const HIGH = 8 * 1024 * 1024; // pause sending above this much queued data (backpressure)
const LOW = 2 * 1024 * 1024; // resume sending when the queue drops below this
const FLUSH = 1024 * 1024; // receiver batches 1 MB before each disk write
const STREAM_MIN = 200 * 1024 * 1024; // only files above this ask where to save (streamed to disk); smaller ones download directly
const CONNECT_TIMEOUT = 30000;
const RELAY_MAX = 25 * 1024 * 1024; // files sent through the relay (devices that cannot connect directly) are limited to 25 MB
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const RELAY_GAP = 30 * 1000; // at most one file through the relay every 30 s
const RELAY_AFTER = 12000; // no direct connection after 12 s: fall back to the (encrypted) relay, code rooms only
let lastRelayAt = Number(sessionStorage.getItem("ft-relay-at")) || 0;
const relayWait = () => Math.max(0, Math.ceil((lastRelayAt + RELAY_GAP - Date.now()) / 1000));
const markRelay = () => (lastRelayAt = Date.now(), sessionStorage.setItem("ft-relay-at", String(lastRelayAt)));

const $ = (s) => document.querySelector(s);
const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "file";

function signalingBase() {
  const configured = window.FILETRANSFER_CONFIG?.signalingUrl;
  if (configured) return configured.replace(/\/+$/, "");
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

// ---------------- state ----------------
let mode = "home"; // home (same-network devices) | room
let ws = null;
let session = 0; // bumped on every connect so events from stale sockets are ignored
let pingTimer = 0;
let me = null;
let roomCode = "";
let isCreator = false;
const myDev = await describeDevice(); // coarse OS / browser info shown to the devices we connect to
const peers = new Map(); // id -> {id, name, dev}
const conns = new Map(); // id -> connection
const queued = new Map(); // id -> File waiting for the data channel to open
let pickFor = null;

// ---------------- UI ----------------
let stickyUntil = 0; // an error shown by goHome() must survive the "hello" of the next connection
let statusTimer = 0;
function setStatus(text, err) {
  const el = $("#status");
  el.textContent = text || "";
  el.hidden = !text;
  el.classList.toggle("err", !!err);
  clearTimeout(statusTimer);
  if (text && err) statusTimer = setTimeout(() => setStatus(""), 8000);
}

function showView(name) {
  $("#view-home").hidden = name !== "home";
  $("#view-room").hidden = name !== "room";
}

// Compact network line: a short IPv6, a short provider name.
const KNOWN_ISP = [
  [/vietnam posts and telecom|vnpt|vinaphone/i, "VNPT"], [/viettel/i, "Viettel"], [/\bfpt\b/i, "FPT"], [/mobifone/i, "MobiFone"],
  [/\bcmc\b/i, "CMC"], [/sctv/i, "SCTV"], [/vietnamobile/i, "Vietnamobile"], [/comcast/i, "Comcast"], [/at&t|att services/i, "AT&T"],
  [/verizon/i, "Verizon"], [/t-mobile/i, "T-Mobile"], [/google/i, "Google"],
];
function shortIsp(s) {
  for (const [re, name] of KNOWN_ISP) if (re.test(s)) return name;
  s = s.split(/\s[-\u2013\u2014]\s|[(,:;]/)[0];
  s = s.replace(/\b(corporation|corp|company|co|ltd|limited|inc|jsc|llc|joint stock|group|telecommunications|telecom|networks?|services?|provider|internet|iptv|ip tv|range|pool|address(es)?|and)\b\.?/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 22 ? s.slice(0, 21) + "\u2026" : s;
}
function shortIp(ip) {
  if (!ip.includes(":")) return ip;
  const g = ip.split(":").filter(Boolean);
  return g.length > 3 ? `${g[0]}:${g[1]}\u2026${g[g.length - 1]}` : ip;
}

function peerCard(p) {
  const card = document.createElement("div");
  card.className = "peer";
  const av = document.createElement("div");
  av.className = "avatar";
  av.innerHTML = deviceIcon(p.dev); // constant SVG markup chosen from a fixed set, never network data
  const who = document.createElement("div");
  who.className = "who";
  const b = document.createElement("b");
  b.textContent = p.name;
  const dev = document.createElement("small");
  dev.textContent = deviceLabel(p.dev);
  who.append(b, dev);
  if (p.net && (p.net.ip || p.net.isp)) {
    // Only sent for code rooms (devices not necessarily on the same network): IP, ISP and country.
    const net = document.createElement("small");
    net.className = "net";
    net.textContent = [shortIp(p.net.ip), shortIsp(p.net.isp || ""), p.net.cc].filter(Boolean).join(" · ");
    net.title = [p.net.ip, p.net.isp].filter(Boolean).join(" · ");
    who.append(net);
  }
  const btn = document.createElement("button");
  btn.className = "btn small";
  btn.textContent = t("send");
  btn.onclick = () => startPick(p.id);
  card.append(av, who, btn);
  card.ondragover = (e) => (e.preventDefault(), card.classList.add("drag"));
  card.ondragleave = () => card.classList.remove("drag");
  card.ondrop = (e) => {
    e.preventDefault();
    card.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f) sendFile(p.id, f);
  };
  return card;
}

function renderPeers() {
  const inRoom = mode === "room";
  // Other tabs of this same browser share its id: they are not "other devices", so they are hidden.
  const list = [...peers.values()].filter((p) => !(myDev.bid && p.dev && p.dev.bid === myDev.bid));
  $("#peers").replaceChildren(...(inRoom ? [] : list.map(peerCard)));
  $("#room-peers").replaceChildren(...(inRoom ? list.map(peerCard) : []));
  $("#lan-steps").hidden = list.length > 0;
  $("#room-empty").hidden = list.length > 0;
}

function renderMe() {
  $("#me").textContent = me && mode === "home" ? t("youAre", `${me.name} (${deviceLabel(myDev)})`) : "";
}

function showRoomCode(code) {
  $("#room-code").replaceChildren(
    ...Array.from(code).map((c) => {
      const d = document.createElement("span");
      d.className = "d";
      d.textContent = c;
      return d;
    })
  );
}

// (Re)apply the current language to static markup and to the dynamic parts that render text.
function renderStatic() {
  applyStatic();
  $("#lang-label").textContent = t("langSwitch");
  digits.forEach((d, i) => d.setAttribute("aria-label", t("digitLabel", i + 1)));
  renderPeers();
  renderMe();
}

// Pressing "Send" opens the file picker and, at the same time, lets the other device know that someone is
// choosing a file, so its popup is already waiting. Cancelling the picker withdraws that notice.
function startPick(pid) {
  pickFor = pid;
  const c = conns.get(pid) || mkConn(pid, true);
  c.choosing = true;
  if (c.dc && c.dc.readyState === "open") c.dc.send(JSON.stringify({ t: "choosing", on: true }));
  $("#file").click();
}

function stopChoosing(pid) {
  const c = conns.get(pid);
  if (!c || !c.choosing) return;
  c.choosing = false;
  if (c.dc && c.dc.readyState === "open") c.dc.send(JSON.stringify({ t: "choosing", on: false }));
}

$("#file").onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f && pickFor) {
    const c = conns.get(pickFor);
    if (c) c.choosing = false; // the offer that follows replaces the "choosing" notice
    sendFile(pickFor, f);
  } else if (pickFor) stopChoosing(pickFor);
};
$("#file").addEventListener("cancel", () => pickFor && stopChoosing(pickFor));

function mkMeter(ui, total, c) {
  const t0 = performance.now();
  let slowSince = 0;
  let noteAt = 0;
  let last = t0;
  let lastBytes = 0;
  let speed = 0; // smoothed current speed in bytes/s
  const m = (bytes) => {
    const now = performance.now();
    if (now - last < 250) return;
    const inst = Math.max(0, bytes - lastBytes) / ((now - last) / 1000);
    speed = speed ? speed * 0.6 + inst * 0.4 : inst;
    last = now;
    lastBytes = bytes;
    // A link that crawls (under 150 KB/s for 6 s) gets a one-line explanation of what it is made of.
    if (c && bytes > 256 * 1024 && speed < 150 * 1024) {
      slowSince = slowSince || now;
      if (now - slowSince > 6000 && now - noteAt > 5000) {
        noteAt = now;
        linkInfo(c).then((s) => s && ui.note(`${t("slowLink")}: ${s}`));
      }
    } else slowSince = 0;
    ui.pct(total ? (bytes / total) * 100 : 100);
    const eta = speed > 1 ? Math.ceil((total - bytes) / speed) : 0;
    ui.info(`${fmt(bytes)} / ${fmt(total)} · ${fmt(speed)}/s${eta > 1 ? " · " + (eta >= 60 ? Math.floor(eta / 60) + "m " + (eta % 60) + "s" : eta + "s") : ""}`);
  };
  m.avg = () => t("avg", fmt(total), fmt(total / ((performance.now() - t0) / 1000 || 1)));
  return m;
}

// ---------------- signaling ----------------
function closeWS() {
  session++;
  clearInterval(pingTimer);
  if (ws) {
    ws.onclose = null;
    try {
      ws.close();
    } catch {}
  }
  ws = null;
}

function resetAll() {
  closeWS();
  for (const id of [...conns.keys()]) closeConn(id);
  queued.clear();
  peers.clear();
  me = null;
  roomCode = "";
  renderMe();
  renderPeers();
}

function connect(kind, code) {
  closeWS();
  const gen = session;
  const sock = new WebSocket(`${signalingBase()}?kind=${kind}${code ? "&code=" + code : ""}${deviceParams(myDev)}`);
  ws = sock;

  sock.onopen = () => {
    pingTimer = setInterval(() => sock.readyState === 1 && sock.send("ping"), 30000);
  };
  sock.binaryType = "arraybuffer";
  sock.onmessage = (e) => {
    if (gen !== session || e.data === "pong") return;
    if (typeof e.data !== "string") return relayIn(e.data); // an encrypted relay frame from the other device
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    onSignal(m);
  };
  sock.onclose = (e) => {
    if (gen !== session) return;
    clearInterval(pingTimer);
    onWsClosed(e.code);
  };
}

// Application close codes sent by the server: 4404 no such room, 4423 room full, 4429 rate limited, 4500 busy.
function onWsClosed(code) {
  if (mode === "room" && (code === 4404 || code === 4423 || code === 4429 || code === 4500)) {
    if (code === 4404 && isCreator && roomCode) {
      // Our own room expired (10 minutes with nobody online): transparently open a new one.
      roomCode = "";
      peers.clear();
      renderPeers();
      setStatus(t("roomExpired"));
      return connect("create");
    }
    return goHome(code === 4404 ? t("noRoom") : code === 4423 ? t("roomFull") : code === 4429 ? t("rateLimited") : t("busy"), true);
  }
  setStatus(code === 4429 ? t("rateLimited") : t("retrying"), true);
  const gen = session;
  setTimeout(() => {
    if (gen !== session) return;
    if (mode === "home") connect("lan");
    else connect(roomCode ? "join" : "create", roomCode);
  }, code === 4429 ? 15000 : 2000); // back off when rate limited
}

function sig(to, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "sig", to, data }));
}

function onSignal(m) {
  if (m.t === "rly-ok" || m.t === "rly-no") return onRelayReply(m);
  if (m.t === "hello") {
    me = { id: m.id, name: m.name };
    peers.clear();
    m.peers.forEach((p) => peers.set(p.id, p));
    if (m.code) {
      roomCode = m.code;
      showRoomCode(m.code);
    }
    if (Date.now() > stickyUntil) setStatus("");
    renderMe();
    renderPeers();
  } else if (m.t === "join") {
    peers.set(m.peer.id, m.peer);
    renderPeers();
  } else if (m.t === "leave") {
    peers.delete(m.id);
    const c = conns.get(m.id);
    if (c && !(c.dc && c.dc.readyState === "open")) closeConn(m.id); // an open P2P channel outlives signaling
    renderPeers();
  } else if (m.t === "sig") {
    onSig(m.from, m.data).catch((e) => console.warn(e));
  }
}

// ---------------- WebRTC ----------------
function mkConn(pid, initiator) {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const c = { pid, pc, initiator, dc: null, cand: [], remoteSet: false, tx: null, rx: null, timer: 0, opened: false, choosing: false, pre: null, preTimer: 0, relay: null, relayCh: null, rlyQ: [], peerPub: "", rlyTimer: 0 };
  if (mode === "room") c.rlyTimer = setTimeout(() => startRelay(c), RELAY_AFTER);
  conns.set(pid, c);
  pc.onicecandidate = (e) => e.candidate && sig(pid, { c: e.candidate });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && conns.get(pid) === c) {
      // Only an error if we never managed to connect. A link that worked and later went away (the other
      // tab was closed, the phone went to sleep) is dropped silently and re-created on the next send.
      if (!c.opened && mode === "room") return startRelay(c); // no direct path: use the relay
      if (!c.opened) setStatus(t("p2pFail"), true);
      closeConn(pid);
    }
  };
  c.timer = setTimeout(() => {
    if (conns.get(pid) === c && !(c.dc && c.dc.readyState === "open")) {
      setStatus(t("p2pTimeout"), true);
      closeConn(pid);
    }
  }, CONNECT_TIMEOUT);
  if (initiator) {
    setupDC(pid, c, pc.createDataChannel("f"));
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => sig(pid, { sdp: pc.localDescription }))
      .catch((e) => console.warn(e));
  } else {
    pc.ondatachannel = (e) => setupDC(pid, c, e.channel);
  }
  return c;
}

function closeConn(pid) {
  const c = conns.get(pid);
  if (!c) return;
  conns.delete(pid);
  clearTimeout(c.timer);
  queued.delete(pid);
  clearTimeout(c.rlyTimer);
  closePre(c);
  cancelTx(c, false, t("lostConn"));
  abortRx(c, false, t("lostConn"));
  if (c.relayCh) c.relayCh.close();
  try {
    c.pc.close();
  } catch {}
}

// ---------------- relay fallback ----------------
// Used only in code rooms, when no direct connection could be made. The Worker grants (or refuses) a session,
// the devices agree on a key (ECDH over the signaling channel) and then talk through encrypted frames.
function startRelay(c) {
  if (c.relay || c.opened || mode !== "room" || !ws || ws.readyState !== 1 || conns.get(c.pid) !== c) return;
  c.relay = { granted: false, priv: null, sent: false, deriving: false };
  setStatus(t("relayConnecting"));
  ws.send(JSON.stringify({ t: "rly-start" }));
}

async function onRelayReply(m) {
  const c = [...conns.values()].find((x) => x.relay);
  if (m.t === "rly-no") {
    if (!c) return;
    // "limit" while sending: the session's byte budget ran out
    if (c.relayCh) return closeConn(c.pid);
    setStatus(t(m.why === "throttled" || m.why === "full" ? "relayBusy" : "p2pFail"), true);
    return closeConn(c.pid);
  }
  if (!c || c.relay.granted) return;
  c.relay.granted = true;
  const kp = await newKeyPair();
  c.relay.priv = kp.priv;
  c.relay.sent = true;
  sig(c.pid, { rk: kp.pub }); // our public key, always sent before any relayed frame
  tryOpenRelay(c);
}

async function tryOpenRelay(c) {
  const r = c.relay;
  if (!r || !r.sent || !c.peerPub || r.deriving || c.relayCh || conns.get(c.pid) !== c) return;
  r.deriving = true;
  try {
    const key = await deriveKey(r.priv, c.peerPub);
    if (conns.get(c.pid) !== c) return;
    clearTimeout(c.rlyTimer);
    c.pc.onconnectionstatechange = null;
    if (c.dc) c.dc.onclose = c.dc.onmessage = c.dc.onopen = null; // the abandoned direct channel must not close us
    try {
      c.pc.close();
    } catch {}
    const ch = new RelayChannel(key, () => ws, () => ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "rly-end" })));
    c.relayCh = ch;
    c.routeKind = "relay";
    c.route = Promise.resolve("relay");
    setupDC(c.pid, c, ch);
    ch.onopen(); // marks the connection as open and starts any queued file
    for (const f of c.rlyQ.splice(0)) ch.receive(f); // frames that arrived while the key was being derived
    setStatus("");
  } catch (e) {
    console.warn(e);
    closeConn(c.pid);
  }
}

function relayIn(buf) {
  const c = [...conns.values()].find((x) => x.relay);
  if (!c) return;
  if (c.relayCh) c.relayCh.receive(buf);
  else c.rlyQ.push(buf);
}

async function onSig(from, d) {
  let c = conns.get(from);
  const flush = async () => {
    c.remoteSet = true;
    for (const x of c.cand.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
  };
  if (d.sdp) {
    if (d.sdp.type === "offer") {
      // Glare (both sides sent an offer): the peer with the smaller id wins.
      if (c && c.initiator && c.pc.signalingState === "have-local-offer" && me.id < from) return;
      if (c) {
        const f = queued.get(from);
        closeConn(from);
        if (f) queued.set(from, f);
      }
      c = mkConn(from, false);
      await c.pc.setRemoteDescription(d.sdp);
      await flush();
      await c.pc.setLocalDescription(await c.pc.createAnswer());
      sig(from, { sdp: c.pc.localDescription });
    } else if (c) {
      await c.pc.setRemoteDescription(d.sdp);
      await flush();
    }
  } else if (d.rk) {
    if (!c || c.opened || typeof d.rk !== "string" || d.rk.length > 200) return;
    c.peerPub = d.rk;
    if (!c.relay) startRelay(c); // the other device went to the relay: follow it
    else tryOpenRelay(c);
  } else if (d.c && c) {
    if (c.remoteSet) c.pc.addIceCandidate(d.c).catch(() => {});
    else c.cand.push(d.c);
  }
}

// How the two devices are connected: same network, direct over the Internet, or through the Worker relay.
function routeOf(c) {
  if (c.relayCh) return Promise.resolve("relay");
  if (!c.route) {
    c.route = (async () => {
      try {
        const stats = await c.pc.getStats();
        let pair;
        stats.forEach((r) => {
          if (r.type === "transport" && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        });
        if (!pair) stats.forEach((r) => r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && (pair = r));
        if (!pair) return null;
        const l = stats.get(pair.localCandidateId);
        const r = stats.get(pair.remoteCandidateId);
        if (!l || !r) return null;
        if (l.candidateType === "relay" || r.candidateType === "relay") return (c.routeKind = "relay");
        return (c.routeKind = l.candidateType === "host" && r.candidateType === "host" ? "lan" : "direct");
      } catch {
        return null;
      }
    })();
  }
  return c.route;
}
// "relay/srflx · tls · 140 ms": candidate types, transport and round-trip time of the link in use.
async function linkInfo(c) {
  if (c.relayCh) return "relay";
  try {
    const stats = await c.pc.getStats();
    let pair;
    stats.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
    });
    if (!pair) return "";
    const l = stats.get(pair.localCandidateId) || {};
    const r = stats.get(pair.remoteCandidateId) || {};
    const proto = l.candidateType === "relay" ? l.relayProtocol || l.protocol : l.protocol;
    const rtt = pair.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) + " ms" : "";
    return [`${l.candidateType || "?"}/${r.candidateType || "?"}`, proto, l.networkType, rtt].filter(Boolean).join(" \u00b7 ");
  } catch {
    return "";
  }
}

const showRoute = (c, ui) => routeOf(c).then((k) => k && k !== "relay" && ui.route(k));

// A relayed link is closed as soon as it is idle: it frees the relay and stops its keep-alive traffic.
function releaseRelay(c, ms) {
  if (c.routeKind !== "relay") return;
  setTimeout(() => {
    if (conns.get(c.pid) === c && !c.tx && !c.rx && !c.pre) closeConn(c.pid);
  }, ms);
}

function setupDC(pid, c, dc) {
  c.dc = dc;
  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = LOW;
  dc.onopen = () => {
    clearTimeout(c.timer);
    clearTimeout(c.rlyTimer);
    c.opened = true;
    routeOf(c); // learn early whether this link is direct or relayed
    if (c.choosing) dc.send(JSON.stringify({ t: "choosing", on: true }));
    const f = queued.get(pid);
    if (f) {
      queued.delete(pid);
      startSend(c, f);
    }
  };
  dc.onmessage = (e) => onData(c, e.data);
  dc.onclose = () => conns.get(pid) === c && closeConn(pid);
}

// ---------------- sending ----------------
function peerName(pid) {
  return peers.get(pid)?.name || t("peerFallback");
}

function sendFile(pid, file) {
  if (file.size > MAX_SIZE) return setStatus(t("tooBig", file.name), true);
  const c = conns.get(pid);
  if (c && c.dc && c.dc.readyState === "open") return startSend(c, file);
  queued.set(pid, file);
  if (!c) mkConn(pid, true);
  setStatus(t("connectingTo", peerName(pid)));
}

function startSend(c, file) {
  setStatus("");
  if (c.tx || c.rx || isTransferOpen()) return setStatus(t("busyTx"), true);
  const ui = openTransfer({ dir: "out", name: file.name, size: file.size, type: file.type, peer: peers.get(c.pid) || { name: peerName(c.pid) } });
  ui.info(t("waitAccept", peerName(c.pid)));
  showRoute(c, ui);
  const tx = { file, ui, cancelled: false, state: "wait" };
  c.tx = tx;
  ui.acts([[t("cancel"), () => cancelTx(c, true, t("canceled"), true)]]);
  // Send the offer together with a small preview when the file is an image.
  Promise.all([makeThumb(file), routeOf(c)]).then(([thumb, route]) => {
    if (tx.cancelled) return;
    if (route === "relay") {
      if (file.size > RELAY_MAX) return cancelTx(c, false, t("relayLimit", fmt(RELAY_MAX))); // too big for the relay
      if (relayWait()) return cancelTx(c, false, t("relayWait", relayWait())); // one relayed file per 30 s
      markRelay();
    }
    if (thumb) ui.setThumb(thumb);
    if (!tx.cancelled && c.dc && c.dc.readyState === "open") {
      c.dc.send(JSON.stringify({ t: "offer", name: file.name, size: file.size, type: file.type, thumb: thumb || undefined }));
    }
  });
}

function cancelTx(c, notify, msg, silent) {
  const tx = c.tx;
  if (!tx) return;
  c.tx = null;
  tx.cancelled = true;
  if (notify && c.dc && c.dc.readyState === "open") c.dc.send(JSON.stringify({ t: "cancel" }));
  if (silent) tx.ui.close();
  else tx.ui.end("fail", msg);
  releaseRelay(c, 600);
}

function drain(dc) {
  return new Promise((res) => {
    const timeout = setTimeout(done, 250); // safety net in case the channel closes while waiting
    function done() {
      clearTimeout(timeout);
      dc.onbufferedamountlow = null;
      res();
    }
    dc.onbufferedamountlow = done;
  });
}

async function runSend(c) {
  const tx = c.tx;
  const dc = c.dc;
  const file = tx.file;
  tx.state = "send";
  const meter = mkMeter(tx.ui, file.size, c);
  tx.meterAvg = meter.avg;
  tx.ui.acts([[t("cancel"), () => cancelTx(c, true, t("canceled"), true)]]);
  // On a relay keep the send buffer small: progress stays truthful and a cancel does not leave megabytes of
  // already-queued data to crawl through the (limited) relay.
  const relayed = c.routeKind === "relay";
  const high = relayed ? 256 * 1024 : HIGH;
  dc.bufferedAmountLowThreshold = relayed ? 64 * 1024 : LOW;
  let sent = 0;
  try {
    let off = 0;
    let next = file.size ? file.slice(0, BLOCK).arrayBuffer() : null;
    while (next) {
      const block = await next;
      off += block.byteLength;
      next = off < file.size ? file.slice(off, off + BLOCK).arrayBuffer() : null; // prefetch the next block
      for (let o = 0; o < block.byteLength; o += CHUNK) {
        if (tx.cancelled || dc.readyState !== "open") return;
        while (dc.bufferedAmount > high) {
          await drain(dc);
          if (tx.cancelled || dc.readyState !== "open") return;
          meter(Math.max(0, sent - dc.bufferedAmount));
        }
        const n = Math.min(CHUNK, block.byteLength - o);
        dc.send(new Uint8Array(block, o, n));
        sent += n;
        meter(Math.max(0, sent - dc.bufferedAmount)); // what has really left, not what is merely queued
      }
    }
    if (tx.cancelled) return;
    dc.send(JSON.stringify({ t: "done" })); // the channel is ordered, so "done" arrives after every chunk
    tx.ui.info(t("waitFinish"));
  } catch (e) {
    if (!tx.cancelled) {
      c.tx = null;
      tx.ui.end("fail", t("errPrefix", e.message));
    }
  }
}

// ---------------- receiving ----------------
function onData(c, data) {
  if (typeof data !== "string") return onChunk(c, data);
  let m;
  try {
    m = JSON.parse(data);
  } catch {
    return;
  }
  const send = (o) => c.dc.readyState === "open" && c.dc.send(JSON.stringify(o));
  switch (m.t) {
    case "choosing":
      if (m.on === false) closePre(c);
      else onChoosing(c);
      break;
    case "offer":
      return onOffer(c, m, send);
    case "accept":
      if (c.tx && c.tx.state === "wait") runSend(c);
      break;
    case "reject":
      if (c.tx) {
        c.tx.ui.end("fail", t("rejectedBy"));
        c.tx = null;
      }
      break;
    case "done":
      finishRx(c, send);
      break;
    case "ok":
      if (c.tx) {
        c.tx.ui.pct(100);
        c.tx.ui.end("done", t("done", c.tx.meterAvg ? c.tx.meterAvg() : ""));
        c.tx = null;
        releaseRelay(c, 3000);
      }
      break;
    case "cancel":
      closePre(c);
      cancelTx(c, false, t("canceledByPeer"));
      abortRx(c, false, t("canceledByPeer"));
      break;
  }
}

// The other device pressed "Send" and is choosing a file: show a waiting popup right away.
function onChoosing(c) {
  if (c.rx || c.tx || isTransferOpen()) return;
  c.pre = openTransfer({ dir: "in", pending: true, peer: peers.get(c.pid) || { name: peerName(c.pid) } });
  c.pre.pending(t("choosing", peerName(c.pid)));
  showRoute(c, c.pre);
  c.pre.acts([[t("close"), () => closePre(c)]]);
  c.preTimer = setTimeout(() => closePre(c), 120000); // give up if no file ever arrives
}

function closePre(c) {
  clearTimeout(c.preTimer);
  if (c.pre) c.pre.close();
  c.pre = null;
}

function onOffer(c, m, send) {
  if (c.routeKind === "relay") {
    // the relay only carries small files, one at a time per 30 s
    if (m.size > RELAY_MAX || relayWait()) return send({ t: "reject" });
    markRelay();
  }
  const waiting = c.pre; // the popup that has been waiting for this very file, if any
  if (c.rx || c.tx || (isTransferOpen() && !waiting) || typeof m.size !== "number" || m.size < 0 || m.size > MAX_SIZE) return send({ t: "reject" });
  const name = safeName(m.name);
  const type = String(m.type || "").slice(0, 100);
  const meta = { name, size: m.size, type, thumb: validThumb(m.thumb) ? m.thumb : null };
  let ui;
  if (waiting) {
    clearTimeout(c.preTimer);
    c.pre = null;
    ui = waiting;
    ui.setFile(meta);
  } else ui = openTransfer({ dir: "in", ...meta, peer: peers.get(c.pid) || { name: peerName(c.pid) } });
  ui.info(t("acceptHint"));
  showRoute(c, ui);
  const rx = { name, size: m.size, type, ui, got: 0, w: null, pend: [], pendBytes: 0, chunks: [], accepted: false, accepting: false };
  rx.meter = mkMeter(ui, m.size, c);
  c.rx = rx;
  ui.acts([
    [t("accept"), () => acceptRx(c, rx, send), true],
    [
      t("reject"),
      () => {
        send({ t: "reject" });
        c.rx = null;
        ui.close();
      },
    ],
  ]);
}

async function acceptRx(c, rx, send) {
  if (rx.accepting) return;
  rx.accepting = true;
  if (window.showSaveFilePicker && rx.size > STREAM_MIN) {
    // Big file on Chrome / Edge: ask where to save and stream straight to disk, so memory stays flat.
    try {
      const h = await window.showSaveFilePicker({ suggestedName: rx.name });
      rx.w = await h.createWritable();
    } catch (e) {
      if (e.name === "AbortError") {
        // The save dialog was dismissed: stay on the prompt so the user can try again or decline.
        rx.accepting = false;
        rx.ui.info(t("pickerCanceled"));
        return;
      }
      // any other error: fall back to buffering in memory and downloading at the end
    }
  }
  if (c.rx !== rx) return rx.w && rx.w.abort().catch(() => {});
  rx.accepted = true;
  rx.ui.info(t("receiving"));
  rx.ui.pct(0);
  rx.ui.acts([[t("cancel"), () => abortRx(c, true, t("canceled"), true)]]);
  send({ t: "accept" });
}

function onChunk(c, buf) {
  const rx = c.rx;
  if (!rx || !rx.accepted) return;
  rx.got += buf.byteLength;
  if (rx.got > rx.size) return abortRx(c, true, t("overSize"));
  if (rx.w) {
    rx.pend.push(buf);
    rx.pendBytes += buf.byteLength;
    if (rx.pendBytes >= FLUSH) flushRx(c, rx);
  } else rx.chunks.push(buf);
  rx.meter(rx.got);
}

function flushRx(c, rx) {
  if (!rx.pend.length) return;
  const blob = new Blob(rx.pend);
  rx.pend = [];
  rx.pendBytes = 0;
  rx.w.write(blob).catch((e) => abortRx(c, true, t("writeErr", e.message)));
}

async function finishRx(c, send) {
  const rx = c.rx;
  if (!rx || !rx.accepted) return;
  try {
    if (rx.got !== rx.size) throw new Error(t("missing"));
    if (rx.w) {
      flushRx(c, rx);
      await rx.w.close(); // resolves after every queued write has finished
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(rx.chunks, { type: rx.type }));
      a.download = rx.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      rx.chunks = [];
    }
    if (c.rx !== rx) return;
    c.rx = null;
    rx.ui.pct(100);
    rx.ui.end("done", t("done", rx.meter.avg()));
    send({ t: "ok" });
    releaseRelay(c, 3000);
  } catch (e) {
    abortRx(c, true, t("errPrefix", e.message));
  }
}

function abortRx(c, notify, msg, silent) {
  const rx = c.rx;
  if (!rx) return;
  c.rx = null;
  if (rx.w) rx.w.abort().catch(() => {});
  rx.chunks = [];
  if (notify && c.dc && c.dc.readyState === "open") c.dc.send(JSON.stringify({ t: "cancel" }));
  if (silent) rx.ui.close();
  else rx.ui.end("fail", msg);
  releaseRelay(c, 600);
}

// ---------------- views, room code input, language ----------------
const digits = [...document.querySelectorAll("#digits input")];
const clearDigits = () => digits.forEach((d) => (d.value = ""));

function startHome() {
  mode = "home";
  resetAll();
  showView("home");
  connect("lan");
}

function goHome(msg, isErr) {
  startHome();
  clearDigits();
  if (msg) {
    stickyUntil = Date.now() + 6000;
    setStatus(msg, isErr);
  }
  if (isErr) {
    const box = $("#digits");
    box.classList.add("shake");
    setTimeout(() => box.classList.remove("shake"), 400);
  }
}

function enterRoom(kind, code) {
  mode = "room";
  resetAll();
  showView("room");
  isCreator = kind === "create";
  roomCode = code || "";
  showRoomCode(code || "••••••");
  renderPeers();
  connect(kind, code);
}

function submitCode() {
  const code = digits.map((d) => d.value).join("");
  if (/^\d{6}$/.test(code)) enterRoom("join", code);
}

digits.forEach((inp, i) => {
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/\D/g, "").slice(-1);
    if (inp.value && i < 5) digits[i + 1].focus();
    if (digits.every((d) => d.value)) submitCode();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !inp.value && i > 0) {
      digits[i - 1].value = "";
      digits[i - 1].focus();
    } else if (e.key === "ArrowLeft" && i > 0) digits[i - 1].focus();
    else if (e.key === "ArrowRight" && i < 5) digits[i + 1].focus();
  });
  inp.addEventListener("paste", (e) => {
    const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    [...text].forEach((c, k) => (digits[k].value = c));
    digits[Math.min(text.length, 5)].focus();
    if (text.length === 6) submitCode();
  });
});

$("#btn-create").onclick = () => enterRoom("create");
$("#btn-leave").onclick = () => startHome();

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t("copied");
    setTimeout(() => (btn.textContent = t(btn.dataset.i18n)), 1500);
  } catch {}
}
$("#btn-copy").onclick = (e) => roomCode && copy(roomCode, e.currentTarget);
$("#btn-copylink").onclick = (e) => roomCode && copy(`${location.origin}${location.pathname}#${roomCode}`, e.currentTarget);

$("#theme").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("ft-theme", next);
  } catch {}
};

$("#lang").onclick = () => {
  setLang(getLang() === "vi" ? "en" : "vi");
  renderStatic();
};

renderStatic();
const hash = location.hash.match(/^#(\d{6})$/);
if (hash) {
  history.replaceState(null, "", location.pathname + location.search); // keep the code out of the address bar / history
  enterRoom("join", hash[1]);
} else startHome();
