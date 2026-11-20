# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-21

### Added
- Browser-to-browser file transfer over WebRTC data channels, up to 1 GB per file.
- Nearby-device discovery (devices sharing a public IP, IPv6 grouped by /64).
- 6-digit room codes for connecting across networks; rooms hold two devices and expire after 10 minutes empty.
- Backpressure and read-ahead on the sender; streaming to disk on the receiver (File System Access API) with an in-memory fallback.
- Per-file consent, cancel from either side, live progress and speed.
- Cloudflare Worker + Durable Object signaling server with an origin allow-list and no logging.
- Home page with a 6-box room-code entry next to same-network discovery, plus step-by-step hints.
- Shareable room links (`/#123456`); the code is removed from the address bar after joining.
- English and Vietnamese UI picked from the browser language (switchable), light and dark theme, strict Content Security Policy.
- Integration tests, CI, and an optional GitHub Actions deploy workflow.
