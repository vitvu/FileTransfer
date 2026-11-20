// Describes the current device (OS, form factor, browser, Android model) so peers can recognise each other
// ("iPhone · Safari"). Only these coarse values are shared, and only with the devices you connect to.

const OS_NAMES = { windows: "Windows", mac: "Mac", linux: "Linux", chromeos: "Chromebook" };
const BROWSER_NAMES = { chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", opera: "Opera", samsung: "Samsung Internet" };

function syncDevice() {
  const ua = navigator.userAgent || "";
  let os = "other";
  let type = "desktop";
  let model = "";
  if (/iPhone|iPod/.test(ua)) (os = "ios"), (type = "phone");
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) (os = "ios"), (type = "tablet");
  else if (/Android/.test(ua)) {
    os = "android";
    type = /Mobile/.test(ua) ? "phone" : "tablet";
    const m = ua.match(/Android [^;]*; ([^;)]+)/);
    if (m && m[1].trim() !== "K") model = m[1].replace(/\s*Build.*/, "").trim(); // Chrome reduces this to "K"
  } else if (/Windows/.test(ua)) os = "windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "mac";
  else if (/CrOS/.test(ua)) os = "chromeos";
  else if (/Linux|X11/.test(ua)) os = "linux";

  let browser = "other";
  if (/Edg\//.test(ua)) browser = "edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "opera";
  else if (/SamsungBrowser/.test(ua)) browser = "samsung";
  else if (/Firefox|FxiOS/.test(ua)) browser = "firefox";
  else if (/Chrome|CriOS/.test(ua)) browser = "chrome";
  else if (/Safari/.test(ua)) browser = "safari";
  return { os, type, browser, model };
}

// Chromium on Android can give the real model through User-Agent Client Hints.
export async function describeDevice() {
  const dev = syncDevice();
  try {
    const uad = navigator.userAgentData;
    if (dev.os === "android" && uad && uad.getHighEntropyValues) {
      const h = await Promise.race([uad.getHighEntropyValues(["model"]), new Promise((r) => setTimeout(r, 400))]);
      if (h && h.model) dev.model = h.model;
    }
  } catch {}
  dev.model = dev.model.replace(/[^\w .+()-]/g, "").trim().slice(0, 24);
  return dev;
}

export function deviceParams(dev) {
  return `&os=${dev.os}&type=${dev.type}&br=${dev.browser}&model=${encodeURIComponent(dev.model)}`;
}

export function deviceLabel(dev) {
  if (!dev) return "";
  let name;
  if (dev.os === "ios") name = dev.type === "tablet" ? "iPad" : "iPhone";
  else if (dev.os === "android") name = dev.model || (dev.type === "tablet" ? "Android tablet" : "Android");
  else name = OS_NAMES[dev.os] || (dev.type === "phone" ? "Phone" : "Computer");
  const br = BROWSER_NAMES[dev.browser];
  return br ? `${name} · ${br}` : name;
}

// Constant, trusted SVG markup (never built from network data).
const BRAND = {
  apple: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  windows: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>',
  android: '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02 1.9973-3.4592a.416.416 0 0 0-.1521-.5676.416.416 0 0 0-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1367 1.0989L4.841 5.4467a.4161.4161 0 0 0-.5677-.1521.4157.4157 0 0 0-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3435-4.1021-2.6892-7.5743-6.1185-9.4396"/></svg>',
};
const GENERIC = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  tablet: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="2.5"/><path d="M11 18h2"/></svg>',
  desktop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
};

export function deviceIcon(dev) {
  if (dev) {
    if (dev.os === "ios" || dev.os === "mac") return BRAND.apple;
    if (dev.os === "windows") return BRAND.windows;
    if (dev.os === "android") return BRAND.android;
    return GENERIC[dev.type] || GENERIC.desktop;
  }
  return GENERIC.desktop;
}
