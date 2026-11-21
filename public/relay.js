// Fallback transport for devices that cannot connect directly (strict NAT on both sides).
// The data goes through the signaling Worker, but it is encrypted in the browsers with AES-GCM, using a key
// the two devices agree on with an ephemeral ECDH exchange, so the Worker only relays ciphertext.
//
// RelayChannel mimics the parts of RTCDataChannel that the app uses (send, bufferedAmount, the
// bufferedamountlow callback, onmessage, onclose), so the transfer code works unchanged on either transport.

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const CURVE = { name: "ECDH", namedCurve: "P-256" };

export async function newKeyPair() {
  const kp = await crypto.subtle.generateKey(CURVE, false, ["deriveKey"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { priv: kp.privateKey, pub: b64(pub) };
}

export async function deriveKey(priv, peerPubB64) {
  const pub = await crypto.subtle.importKey("raw", unb64(peerPubB64), CURVE, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: pub }, priv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Frame on the wire: [1 byte: 0 = text, 1 = binary][12 byte random IV][AES-GCM ciphertext + tag]
export class RelayChannel {
  constructor(key, getWs, onClose) {
    this.key = key;
    this.getWs = getWs;
    this.onCloseHook = onClose;
    this.readyState = "open";
    this.binaryType = "arraybuffer";
    this.bufferedAmountLowThreshold = 0;
    this.onbufferedamountlow = null;
    this.onmessage = null;
    this.onclose = null;
    this.pending = 0; // bytes waiting to be encrypted
    this.tx = Promise.resolve(); // encryption / sending and decryption keep strict order
    this.rx = Promise.resolve();
    // the WebSocket has no "buffer drained" event, so poll for it
    this.timer = setInterval(() => this.pump(), 40);
  }

  get bufferedAmount() {
    const ws = this.getWs();
    return this.pending + (ws ? ws.bufferedAmount : 0);
  }

  pump() {
    if (this.onbufferedamountlow && this.bufferedAmount <= this.bufferedAmountLowThreshold) this.onbufferedamountlow();
  }

  send(data) {
    const text = typeof data === "string";
    const plain = text ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const n = plain.byteLength;
    this.pending += n;
    this.tx = this.tx
      .then(async () => {
        if (this.readyState !== "open") return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, plain));
        const frame = new Uint8Array(13 + ct.length);
        frame[0] = text ? 0 : 1;
        frame.set(iv, 1);
        frame.set(ct, 13);
        const ws = this.getWs();
        if (ws && ws.readyState === 1) ws.send(frame);
      })
      .catch(() => {})
      .finally(() => (this.pending -= n));
  }

  receive(buf) {
    this.rx = this.rx
      .then(async () => {
        const u = new Uint8Array(buf);
        if (this.readyState !== "open" || u.length < 30) return;
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(1, 13) }, this.key, u.subarray(13));
        if (this.onmessage) this.onmessage({ data: u[0] === 0 ? new TextDecoder().decode(pt) : pt });
      })
      .catch(() => {}); // a frame that does not authenticate is dropped
  }

  close() {
    if (this.readyState !== "open") return;
    this.readyState = "closed";
    clearInterval(this.timer);
    try {
      this.onCloseHook && this.onCloseHook();
    } catch {}
    if (this.onclose) this.onclose();
  }
}
