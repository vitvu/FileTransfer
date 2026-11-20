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
    const q = [];
    let wake;
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      q.push(JSON.parse(e.data));
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

process.exit(fails ? 1 : 0);
