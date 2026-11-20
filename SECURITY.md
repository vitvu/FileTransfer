# Security Policy

## Supported versions

Only the latest commit on `main` is supported.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report them privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting). Include:

- a description of the issue and its impact,
- steps or a proof of concept to reproduce it,
- the affected component (`public/` web app or `src/worker.js` signaling Worker).

You can expect an acknowledgement within a few days. Please allow reasonable time for a fix before any public disclosure.

## Scope

In scope: the web app, the signaling Worker, and the deployment configuration in this repository.

Out of scope: vulnerabilities in browsers, Cloudflare, GitHub, or STUN/TURN infrastructure; denial of service through raw traffic volume; and the fact that a 6-digit room code is guessable (a documented limitation: the receiver must still approve every file).

## Design notes relevant to security

- File data travels over a DTLS-encrypted WebRTC data channel and never reaches the signaling Worker.
- The Worker enforces an Origin allow-list, a 16 KB message limit, and small room sizes, and keeps no logs or file data.
- All peer-supplied text (names, file names) is rendered with `textContent`, and the page ships with a strict Content Security Policy.
