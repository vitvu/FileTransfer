// The transfer popup: one dialog that shows the incoming / outgoing file (image preview or a file-type icon),
// who it is from / to, progress, and the actions. While it is open the rest of the page is hidden and inert.
// It can start in a "pending" state ("X is choosing a file…") and switch to the file with setFile().
import { t } from "./i18n.js";
import { deviceIcon, deviceLabel } from "./device.js";

export const fmt = (n) => {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) (n /= 1024), i++;
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

// ---------- thumbnails ----------
const THUMB_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const THUMB_MAX = 40000; // characters of the data URL
export const validThumb = (s) => typeof s === "string" && s.length < THUMB_MAX && THUMB_RE.test(s);

// JPEG preview (about 15-35 KB) of an image, sent along with the file offer. Returns null if not possible.
export async function makeThumb(file) {
  if (!/^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(file.type) || file.size > 30 * 1024 * 1024) return null;
  try {
    const bmp = await createImageBitmap(file);
    for (const [max, q] of [[360, 0.72], [280, 0.6], [200, 0.55], [120, 0.45]]) {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", q);
      if (url.length < THUMB_MAX - 2000) {
        if (bmp.close) bmp.close();
        return url;
      }
    }
    if (bmp.close) bmp.close();
  } catch {}
  return null;
}

// ---------- file-type icons (constant markup) ----------
const ICONS = {
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8M2 4h20v4H2zM10 12h4"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
};
const CATS = {
  image: "jpg jpeg png gif webp heic heif bmp svg avif tif tiff",
  video: "mp4 mov mkv avi webm m4v wmv",
  audio: "mp3 wav m4a flac aac ogg opus",
  archive: "zip rar 7z tar gz tgz bz2 xz iso dmg",
  doc: "pdf doc docx xls xlsx ppt pptx txt md csv rtf odt json",
};
function fileKind(name, type) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  for (const [cat, list] of Object.entries(CATS)) if (list.split(" ").includes(ext)) return { cat, ext };
  const m = /^(image|video|audio)\//.exec(type || "");
  return { cat: m ? m[1] : "file", ext: name.includes(".") ? ext : "" };
}

// ---------- the dialog ----------
const SKELETON = `
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="m-title">
  <div class="m-peer"><span class="avatar"></span><div class="who"><b></b><small></small></div></div>
  <h3 id="m-title" class="m-title"></h3>
  <div class="m-wait" hidden><span class="spin"></span><span class="m-wait-text"></span></div>
  <div class="m-file" hidden>
    <div class="m-thumb"><span class="m-ext"></span><span class="m-badge"></span></div>
    <div class="m-meta"><div class="m-name"></div><div class="m-size"></div></div>
  </div>
  <div class="m-progress" hidden><div class="bar"><i></i></div><div class="m-pct"></div></div>
  <p class="m-msg"></p>
  <div class="m-acts"></div>
</div>`;

const BADGES = {
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  fail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

let open = false;
export const isTransferOpen = () => open;

// opts: { dir: "in" | "out", peer: {name, dev}, pending?: true, name, size, type, thumb }
export function openTransfer(opts) {
  const root = document.getElementById("modal");
  root.innerHTML = SKELETON;
  const q = (s) => root.querySelector(s);
  const sheet = q(".sheet");
  open = true;
  root.hidden = false;
  document.querySelector("main").inert = true;
  document.querySelector(".topbar").inert = true;

  const peer = opts.peer || {};
  q(".avatar").innerHTML = deviceIcon(peer.dev); // constant markup chosen from a fixed set
  q(".who b").textContent = peer.name || "";
  q(".who small").textContent = deviceLabel(peer.dev);
  q(".m-title").textContent = t(opts.dir === "in" ? "incomingTitle" : "sendingTitle");

  const fileBox = q(".m-file");
  const thumbBox = q(".m-thumb");
  const setThumb = (url) => {
    if (!validThumb(url)) return;
    thumbBox.querySelector("svg")?.remove();
    q(".m-ext").textContent = "";
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    thumbBox.classList.add("has-img");
    fileBox.classList.add("big"); // a real preview gets the full width of the popup
    thumbBox.prepend(img);
  };
  // Fill in (or change to) the file being transferred.
  const setFile = ({ name, size, type, thumb }) => {
    q(".m-wait").hidden = true;
    fileBox.hidden = false;
    q(".m-name").textContent = name;
    q(".m-size").textContent = fmt(size);
    const { cat, ext } = fileKind(name, type);
    thumbBox.querySelector("svg")?.remove();
    thumbBox.querySelector("img")?.remove();
    thumbBox.classList.remove("has-img");
    fileBox.classList.remove("big");
    thumbBox.insertAdjacentHTML("afterbegin", ICONS[cat] || ICONS.file); // constant markup
    q(".m-ext").textContent = ext.slice(0, 4).toUpperCase();
    if (thumb) setThumb(thumb);
  };

  if (opts.pending) {
    q(".m-wait").hidden = false;
    fileBox.hidden = true;
  } else setFile(opts);

  let ended = false;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    root.hidden = true;
    root.replaceChildren();
    document.querySelector("main").inert = false;
    document.querySelector(".topbar").inert = false;
    open = false;
  };
  const onKey = (e) => {
    if (e.key === "Escape" && ended) close();
  };
  document.addEventListener("keydown", onKey);
  root.onclick = (e) => {
    if (e.target === root && ended) close();
  };

  const ui = {
    close,
    setThumb,
    setFile,
    pending(text) {
      q(".m-wait-text").textContent = text;
    },
    pct(p) {
      q(".m-progress").hidden = false;
      q(".bar i").style.width = p.toFixed(1) + "%";
      q(".m-pct").textContent = Math.floor(p) + "%";
    },
    info(text) {
      q(".m-msg").textContent = text;
    },
    acts(list) {
      q(".m-acts").replaceChildren(
        ...list.map(([label, fn, primary]) => {
          const b = document.createElement("button");
          b.className = primary ? "btn primary" : "btn ghost";
          b.textContent = label;
          b.onclick = fn;
          return b;
        })
      );
      const first = q(".m-acts button");
      if (first) first.focus();
    },
    end(cls, text) {
      ended = true;
      sheet.dataset.state = cls;
      q(".m-badge").innerHTML = BADGES[cls] || "";
      ui.info(text);
      ui.acts([[t("close"), close, true]]);
    },
  };
  return ui;
}
