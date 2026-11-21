// Tiny i18n: English and Vietnamese. The language follows the browser (navigator.languages) and
// can be switched with the button in the header. Nothing is persisted (no cookies / localStorage).
const en = {
  htmlTitle: "FileTransfer · Send files device to device",
  badge: "No sign-up · No upload",
  heroA: "Send files,",
  heroB: "device to device.",
  lead: "Files go straight from one browser to another, encrypted. Up to 1 GB, no account, and nothing is stored on a server.",

  codeTitle: "Enter a room code",
  codeDesc: "Type the 6-digit code the other person gave you. Or create a room and share your own code.",
  digitLabel: (n) => `Digit ${n} of 6`,
  or: "or",
  create: "Create a room",

  lanTitle: "Same Wi-Fi / LAN",
  lanDesc: "Devices on your network show up here automatically.",
  lanStep1: "Open this page on both devices, on the same Wi-Fi or network.",
  lanStep2: "The other device appears in this card.",
  lanStep3: "Pick it, choose a file, and the other side taps Accept.",

  f1: "Direct and encrypted, never uploaded",
  f2: "Up to 1 GB, delivered unchanged",
  f3: "Rooms close after 10 min empty",

  roomBadge: "Room",
  roomTitle: "Share this code",
  roomDesc: "The other device enters it on the home page, or opens the link below.",
  copyCode: "Copy code",
  copyLink: "Copy link",
  copied: "Copied",
  leave: "Leave room",
  emptyRoom: "Waiting for the other device to join…",
  emptyLan: "No other device yet",

  footer: "Files travel directly between devices (WebRTC, encrypted). The server never sees them.",
  send: "Send file",
  youAre: (n) => `You appear as ${n}`,
  connecting: "Connecting…",
  connectingTo: (n) => `Connecting to ${n}…`,
  tooBig: (f) => `"${f}" is larger than 1 GB and cannot be sent.`,
  busyTx: "Another file is already being transferred. Wait for it to finish.",
  peerFallback: "the other device",
  waitAccept: (n) => `Waiting for ${n} to accept…`,
  incomingTitle: "Incoming file",
  sendingTitle: "Sending file",
  acceptHint: "Accept to receive this file.",
  relayLimit: (n) => `Different networks: ${n} max per file.`,
  relayWait: (s) => `Please wait ${s}s before sending another file.`,
  relayBusy: "Relay is busy. Try again in a minute.",
  routeLan: "Direct · same network",
  routeDirect: "Direct",
  choosing: (n) => `${n} is choosing a file…`,
  close: "Close",
  cancel: "Cancel",
  accept: "Accept",
  reject: "Decline",
  declined: "Declined",
  rejectedBy: "Declined by the other device",
  canceled: "Canceled",
  canceledByPeer: "Canceled by the other device",
  lostConn: "Connection lost",
  pickerCanceled: "No save location chosen. Press Accept to choose again, or Decline.",
  receiving: "Receiving…",
  waitFinish: "Waiting for the receiver to finish…",
  done: (avg) => `Done · ${avg}`,
  avg: (size, speed) => `${size} · average ${speed}/s`,
  errPrefix: (m) => `Error: ${m}`,
  overSize: "Received more data than announced",
  writeErr: (m) => `Could not write file: ${m}`,
  missing: "data is missing",
  roomExpired: "The previous room expired, creating a new one…",
  noRoom: "That room does not exist or has closed.",
  roomFull: "That room already has 2 devices.",
  busy: "The server is busy, try again later.",
  retrying: "Lost connection to the server, retrying…",
  rateLimited: "Too many attempts. Please wait a minute and try again.",
  p2pFail: "Could not connect directly (your network blocks peer-to-peer).",
  p2pTimeout: "Timed out while connecting to the other device.",
  langSwitch: "Tiếng Việt",
  themeToggle: "Switch light / dark theme",
};

const vi = {
  htmlTitle: "FileTransfer · Gửi file giữa các thiết bị",
  badge: "Không cần đăng ký · Không upload",
  heroA: "Gửi file nhanh,",
  heroB: "trực tiếp giữa các máy.",
  lead: "File đi thẳng từ trình duyệt này sang trình duyệt kia, được mã hóa. Tối đa 1 GB, không cần tài khoản, không lưu gì trên máy chủ.",

  codeTitle: "Nhập mã phòng",
  codeDesc: "Nhập mã 6 số mà người kia gửi cho bạn. Hoặc tạo phòng mới và gửi mã của bạn cho họ.",
  digitLabel: (n) => `Chữ số ${n} trên 6`,
  or: "hoặc",
  create: "Tạo phòng mới",

  lanTitle: "Cùng Wi-Fi / mạng LAN",
  lanDesc: "Các thiết bị trong cùng mạng sẽ tự hiện ở đây.",
  lanStep1: "Mở trang này trên cả hai thiết bị, cùng một mạng Wi-Fi hoặc LAN.",
  lanStep2: "Thiết bị kia sẽ tự xuất hiện trong thẻ này.",
  lanStep3: "Chọn thiết bị, chọn file, bên kia bấm Nhận là xong.",

  f1: "Truyền trực tiếp, mã hóa, không upload",
  f2: "Tối đa 1 GB, file giữ nguyên",
  f3: "Phòng tự đóng sau 10 phút không ai",

  roomBadge: "Phòng",
  roomTitle: "Gửi mã này cho người kia",
  roomDesc: "Họ nhập mã ở trang chủ, hoặc mở đường link bên dưới.",
  copyCode: "Sao chép mã",
  copyLink: "Sao chép link",
  copied: "Đã chép",
  leave: "Rời phòng",
  emptyRoom: "Đang chờ thiết bị kia vào phòng…",
  emptyLan: "Chưa có thiết bị khác",

  footer: "File đi thẳng giữa hai thiết bị (WebRTC, được mã hóa). Máy chủ không thấy file.",
  send: "Gửi file",
  youAre: (n) => `Bạn hiện là ${n}`,
  connecting: "Đang kết nối…",
  connectingTo: (n) => `Đang kết nối tới ${n}…`,
  tooBig: (f) => `"${f}" lớn hơn 1 GB, không gửi được.`,
  busyTx: "Đang có file khác truyền, đợi xong rồi gửi tiếp.",
  peerFallback: "thiết bị kia",
  waitAccept: (n) => `Chờ ${n} đồng ý…`,
  incomingTitle: "File đến",
  sendingTitle: "Đang gửi file",
  acceptHint: "Bấm Nhận để nhận file này.",
  relayLimit: (n) => `Khác mạng: tối đa ${n} mỗi file.`,
  relayWait: (s) => `Chờ ${s} giây rồi gửi file tiếp.`,
  relayBusy: "Relay đang bận, thử lại sau 1 phút.",
  routeLan: "Trực tiếp · cùng mạng",
  routeDirect: "Trực tiếp",
  choosing: (n) => `${n} đang chọn file…`,
  close: "Đóng",
  cancel: "Hủy",
  accept: "Nhận",
  reject: "Từ chối",
  declined: "Đã từ chối",
  rejectedBy: "Bên kia từ chối",
  canceled: "Đã hủy",
  canceledByPeer: "Bên kia đã hủy",
  lostConn: "Mất kết nối",
  pickerCanceled: "Chưa chọn nơi lưu. Bấm Nhận để chọn lại, hoặc Từ chối.",
  receiving: "Đang nhận…",
  waitFinish: "Đang chờ bên nhận hoàn tất…",
  done: (avg) => `Hoàn tất · ${avg}`,
  avg: (size, speed) => `${size} · trung bình ${speed}/s`,
  errPrefix: (m) => `Lỗi: ${m}`,
  overSize: "Dữ liệu vượt kích thước đã khai báo",
  writeErr: (m) => `Lỗi ghi file: ${m}`,
  missing: "thiếu dữ liệu",
  roomExpired: "Phòng cũ đã hết hạn, đang tạo phòng mới…",
  noRoom: "Mã phòng không tồn tại hoặc đã đóng.",
  roomFull: "Phòng đã đủ 2 thiết bị.",
  busy: "Máy chủ đang bận, thử lại sau.",
  retrying: "Mất kết nối máy chủ, đang thử lại…",
  rateLimited: "Bạn thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.",
  p2pFail: "Không kết nối trực tiếp được (mạng chặn P2P).",
  p2pTimeout: "Hết thời gian chờ kết nối với thiết bị kia.",
  langSwitch: "English",
  themeToggle: "Đổi giao diện sáng / tối",
};

const dicts = { en, vi };
const detect = () => ((navigator.languages && navigator.languages[0]) || navigator.language || "en").toLowerCase().startsWith("vi") ? "vi" : "en";
let lang = detect();

export const getLang = () => lang;
export function setLang(l) {
  lang = l === "vi" ? "vi" : "en";
}

export function t(key, ...args) {
  const v = dicts[lang][key] ?? en[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

// Translate static markup: data-i18n="key" (text), data-i18n-ph (placeholder), data-i18n-label (aria-label).
export function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t("htmlTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
}
