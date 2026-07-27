# Cookiedip

Open source cookie identification inspired by tools used by privacy regulators.

Privacy regulators around the world are investigating company websites for violations against user privacy rights. Violations that are not fixed promptly can result in fines and consent decrees against organizations. Here are some examples:

- California https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-settlement-sephora-part-ongoing-enforcement
- United Kingdom https://ico.org.uk/media2/migrated/4027811/cookie-banner-concerns.pdf
- France https://www.edpb.europa.eu/news/national-news/2025/french-sa-cookies-and-advertisements-inserted-between-emails-google-fined_en

# Features

Cookiedip contains only one feature right now.

- Cookies, local storage, and session storage identification in polling and network monitoring

# Dependencies

This library relies on [Puppeteer](https://github.com/puppeteer/puppeteer) and its supported browsers for its capabilities.

## Installation

1. Install dependencies:

```bash
npm install
```

2. You can run the CLI locally with `npx` or install it globally.

## Usage

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
} from 'cookiedip';

const result = await runBrowserStorageScan('https://example.com', {
  captureWindowMs: 5000,
  navigationTimeoutMs: 50000,
  scanTimeoutMs: 100000,
  locale: 'en-US',
  timezone: 'America/New_York',
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
      "setCookieHeader": "session_id=[redacted]; Path=/; HttpOnly",
      "observedAt": 81
    }
  ]
}
```

Cookiedip excludes raw `localStorage`, `sessionStorage`, and cookie values. Events detected from HTTP responses include the originating `Set-Cookie` header as `setCookieHeader`, with every cookie value replaced by `[redacted]` before the event is created; cookie names and attributes remain available for inspection. Other result fields report metadata about names, origins, observed state transitions, and the evidence source used to detect them.

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
