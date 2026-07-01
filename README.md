# Cookiedip

Cookiedip is a reusable Puppeteer-based scanner for cookie, `localStorage`, and `sessionStorage` activity on public websites. It is the open-source extraction of the browser-storage collector used inside Justicar, with private queueing, VPN routing, persistence, and deployment logic left out.

## Installation

```bash
npm install cookiedip
```

Cookiedip requires Node.js 20 or newer and a Puppeteer-compatible Chromium runtime. By default it uses Puppeteer's bundled browser unless you provide `--executable-path` or `PUPPETEER_EXECUTABLE_PATH`.

## CLI

```bash
npx cookiedip https://example.com
```

Optional compatibility form:

```bash
npx cookiedip https://example.com browserStorage
```

Supported options:

- `--capture-window <ms>`
- `--navigation-timeout <ms>`
- `--scan-timeout <ms>`
- `--locale <value>`
- `--timezone <value>`
- `--viewport <width>x<height>`
- `--user-agent <value>`
- `--executable-path <path>`
- `--puppeteer-arg <value>` (repeatable)

Removed in `1.0.0`:

- `--poll-delay`
- `--poll-times`

Those flags belonged to the old polling-only implementation. The replacement scanner observes browser-storage activity through runtime instrumentation, CDP DOM storage events, and cookie headers instead.

## Library API

```js
import {
  closeBrowserStorageWorkers,
  normalizeUrl,
  runBrowserStorageScan,
  runBrowserStorageScanInWorker,
  validatePublicUrl,
  warmBrowserStorageWorker,
} from "cookiedip";

const result = await runBrowserStorageScan("https://example.com", {
  captureWindowMs: 5000,
  navigationTimeoutMs: 50000,
  scanTimeoutMs: 100000,
  locale: "en-US",
  timezone: "America/New_York",
  viewport: { width: 1365, height: 768 },
});
```

## Result Shape

Cookiedip returns a single scan result object:

```json
{
  "submittedUrl": "https://example.com",
  "normalizedUrl": "https://example.com/",
  "finalUrl": "https://example.com/",
  "runTimestamp": "2026-06-30T12:00:00.000Z",
  "browserDuration": 1421,
  "lastEventDetectedInRun": 1294,
  "items": [
    {
      "origin": "https://example.com",
      "storageType": "cookies",
      "name": "session_id",
      "lastKnownState": "present",
      "evidenceSources": ["cookie-header", "js-monkeypatch-intercept"]
    }
  ],
  "events": [
    {
      "origin": "https://example.com",
      "storageType": "cookies",
      "name": "session_id",
      "action": "set",
      "evidenceSource": "cookie-header",
      "observedAt": 81
    }
  ]
}
```

Cookiedip intentionally excludes raw cookie values and raw storage values. It reports metadata about names, origins, observed state transitions, and the evidence source used to detect them.

## Security Notes

- Cookiedip only accepts public `http:` and `https:` URLs. Loopback and RFC1918 IPv4 targets are rejected.
- URL validation is not a replacement for network-level egress controls. If you run Cookiedip against untrusted input, isolate it appropriately.
- Chromium runs with the same sandbox-safe defaults used by the Justicar scanner. Review those defaults before changing them for your own environment.

## Worker Mode

`runBrowserStorageScanInWorker` and `warmBrowserStorageWorker` let callers reuse a persistent browser in a child process. This is useful when you need repeated scans without paying Chromium startup cost each time.

Always call `closeBrowserStorageWorkers()` during shutdown so the child browser processes exit cleanly.

## Development

```bash
npm install
npm test
npm pack --dry-run
```
