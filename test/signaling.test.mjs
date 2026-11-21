// Integration test for the signaling server.
// Start it first:  npm run dev   (defaults to ws://localhost:8787)
// Override the target with BASE=ws://host:port
const BASE = process.env.BASE || "ws://localhost:8787";
let fails = 0;
const ok = (cond, msg) => (console.log((cond ? "PASS " : "FAIL ") + msg), cond || fails++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(qs) {
  return new Promise((res) => {
    const ws = new WebSocket(`${BASE}/ws?${qs}`);
    ws.binaryType = "arraybuffer";
    const q = [];
    let wake;
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      q.push(typeof e.data === "string" ? JSON.parse(e.data) : { t: "bin", n: e.data.byteLength });
      wake && wake();
    };
    const o = {
      ws,
      closed: null,
      next: (type) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout waiting for " + type)), 4000);
          const check = () => {
            const i = q.findIndex((m) => !type || m.t === type);
            if (i >= 0) (clearTimeout(timer), resolve(q.splice(i, 1)[0]));
            else wake = check;
          };
          check();
        }),
      close: () => ws.close(),
    };
    ws.onclose = (e) => (o.closed = e.code);
    ws.onopen = () => res(o);
  });
}

// --- LAN group: two devices see each other and can exchange signaling messages
const a = await open("kind=lan");
const ha = await a.next("hello");
const b = await open("kind=lan");
const hb = await b.next("hello");
ok(hb.peers.length === 1 && hb.peers[0].id === ha.id, "LAN: B sees A in its peer list");
ok((await a.next("join")).peer.id === hb.id, "LAN: A is told that B joined");
a.ws.send(JSON.stringify({ t: "sig", to: hb.id, data: { x: 1 } }));
const s = await b.next("sig");
ok(s.from === ha.id && s.data.x === 1, "LAN: signaling is relayed A -> B");
b.close();
ok((await a.next("leave")).id === hb.id, "LAN: A is told that B left");
a.close();

// --- Device info is shared with peers, and sanitized by the server
const d1 = await open("kind=lan&os=ios&type=phone&br=safari&model=");
await d1.next("hello");
const d2 = await open("kind=lan&os=%3Cscript%3E&type=x&br=evil&model=" + encodeURIComponent("Pixel 7 <b>x</b>" + "y".repeat(40)));
const hd2 = await d2.next("hello");
const seen = hd2.peers.find((p) => p.dev && p.dev.os === "ios");
ok(seen && seen.dev.type === "phone" && seen.dev.browser === "safari", "Device: peer's iOS / phone / Safari info is relayed");
const joined = (await d1.next("join")).peer.dev;
ok(joined.os === "other" && joined.type === "desktop" && joined.browser === "other", "Device: unknown os/type/browser values fall back to safe defaults");
ok(!/[<>]/.test(joined.model) && joined.model.length <= 24, `Device: model string is sanitized and capped (${JSON.stringify(joined.model)})`);
d1.close();
d2.close();
await sleep(200);

// --- Code rooms
const c = await open("kind=create");
const hc = await c.next("hello");
ok(/^\d{6}$/.test(hc.code), `Room: created with a 6-digit code (${hc.code})`);
const d = await open(`kind=join&code=${hc.code}`);
const hd = await d.next("hello");
ok(hd.peers.length === 1, "Room: second device can join");
const e = await open(`kind=join&code=${hc.code}`);
await sleep(400);
ok(e.closed === 4423, `Room: a third device is refused (close code ${e.closed})`);
const f = await open("kind=join&code=000000");
await sleep(400);
ok(f.closed === 4404, `Room: unknown code is refused (close code ${f.closed})`);
const g = await open("kind=join&code=abc");
await sleep(400);
ok(g.closed === 4404, "Room: malformed code is refused");
c.close();
d.close();
await sleep(300);
const h = await open(`kind=join&code=${hc.code}`);
await sleep(400);
ok(h.closed === null, "Room: an empty room stays joinable until it expires (10 min)");
h.close();

// --- Relay (fallback for devices that cannot connect directly): granted per session, limited per IP
const rc = await open("kind=create");
const rh = await rc.next("hello");
const rd = await open(`kind=join&code=${rh.code}`);
await rd.next("hello");
const got = (o, type) => o.next(type).then(() => true, () => false);
rd.ws.send(new Uint8Array(100)); // no relay session granted yet
ok(!(await got(rc, "bin")), "Relay: frames are dropped until a session is granted");
rc.ws.send(JSON.stringify({ t: "rly-start" }));
await rc.next("join");
const first = (await rc.next()).t; // rly-ok, or rly-no when this IP started a session in the last 30 s
if (first === "rly-ok") {
  rc.ws.send(new Uint8Array(1000));
  const fwd = await rd.next("bin");
  ok(fwd.n === 1000, "Relay: a granted session forwards frames to the other device");
} else console.log("SKIP Relay forwarding (a session was already started from this IP in the last 30 s)");
rc.ws.send(JSON.stringify({ t: "rly-end" }));
rc.ws.send(JSON.stringify({ t: "rly-start" }));
const again = await rc.next("rly-no");
ok(again.why === "throttled", "Relay: a second session from the same IP within 30 s is refused");
rc.close();
rd.close();

process.exit(fails ? 1 : 0);
