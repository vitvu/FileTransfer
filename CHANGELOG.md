# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-21

### Added
- Browser-to-browser file transfer over WebRTC data channels, up to 1 GB per file.
- Nearby-device discovery (devices sharing a public IP, IPv6 grouped by /64).
- 6-digit room codes for connecting across networks; rooms hold two devices and expire after 10 minutes empty.
- Backpressure and read-ahead on the sender; streaming to disk on the receiver (File System Access API) with an in-memory fallback.
- Transfer popup for sender and receiver: who it is from, image preview or file-type icon, size, Accept / Decline, live progress and result; the page behind it is hidden and inert.
- Image previews: a small JPEG thumbnail (under 16 KB) travels with the offer, validated by the receiver.
- Small files download directly (no save dialog); files over 200 MB ask where to save on Chrome/Edge and stream to disk. Dismissing the save dialog returns to the prompt instead of failing.
- Cloudflare Worker + Durable Object signaling server with an origin allow-list and no logging.
- Home page with a 6-box room-code entry next to same-network discovery, plus step-by-step hints.
- Shareable room links (`/#123456`); the code is removed from the address bar after joining.
- Device label and OS icon next to each nearby device (iPhone · Safari, Windows · Chrome, Pixel 7 · Chrome), validated server-side.
- Device detection cross-checks User-Agent Client Hints, touch support and screen size, so Android / iPhone in "request desktop site" mode are not mislabeled as Windows / Mac.
- English and Vietnamese UI picked from the browser language (switchable); light theme by default with a dark-mode button; strict Content Security Policy.
- Best-effort per-IP rate limiting of signaling connections and room joins (Workers Rate Limiting bindings).
- Security headers for the static site (`public/_headers`): CSP with `frame-ancestors`, HSTS, nosniff, referrer and permissions policies.
- PayPal donate link in the README.
- Integration tests, CI, and an optional GitHub Actions deploy workflow.
