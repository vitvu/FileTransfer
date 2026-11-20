# Contributing

Thanks for your interest in improving FileTransfer. By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

```bash
npm install
npm run dev     # UI + signaling on http://localhost:8787
npm test        # integration tests, run in a second terminal while dev is running
```

Requirements: Node.js 20 or newer.

## Guidelines

- Keep the front end dependency-free: plain HTML, CSS and ES modules, no build step.
- Insert any text that comes from the network or from a file name with `textContent`, never `innerHTML`.
- The signaling Worker must stay stateless and log-free. Do not add logging of IP addresses or payloads.
- Add or update tests in `test/` when you change signaling behavior.
- Add new UI strings to both languages in `public/i18n.js`.
- Keep pull requests focused, and describe what changed and why.

## Reporting bugs and requesting features

Open an issue with steps to reproduce, the browsers and operating systems on both devices, and whether the devices were on the same network. For security issues see [SECURITY.md](SECURITY.md).
