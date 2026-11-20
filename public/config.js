// Runtime configuration of the web UI.
//
// signalingUrl: WebSocket URL of the signaling server, e.g. "wss://files.example.com/ws".
// Leave it empty to use the same origin as the page, which is the default when the web app
// and the Worker are deployed together (see wrangler.toml) and in local development.
// Only set it if you host the static files somewhere other than the Worker.
window.FILETRANSFER_CONFIG = {
  signalingUrl: "",
};
