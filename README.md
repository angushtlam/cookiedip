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

or if installed globally:

```bash
npm install -g .
cookiedip https://example.com browserStorage
```

## Arguments

| Argument | Required | Default | Description |
| --- | --- | --- | --- |
| `<url>` | Yes | None | Website URL to inspect. URLs without a protocol are treated as `https://` URLs. |
| `[type]` | No | `browserStorage` | Output type to collect. Currently only `browserStorage` is supported. |
| `--poll-delay <ms>` | No | `1000` | Delay in milliseconds between polling snapshots. |
| `--poll-times <count>` | No | `5` | Number of polling snapshots to collect. |
| `--help`, `-h` | No | None | Print CLI usage. |

Example with polling options:

```bash
npx cookiedip --poll-delay 1000 --poll-times 5 https://example.com browserStorage
```

## Output

For `browserStorage`, the CLI prints an object containing cookies, localStorage, sessionStorage, and network cookie set/unset activity.

If a cookie is labeled as "set", it means the cookie is found on the page at the last check, and assumed to be loaded at the end of the page.

If a cookie is labeled as "unset", it means the cookie was set at one point from the initial load, then deleted before the last check. Cookies that were set then unset are still considered to be used even if it was only for a fraction of a second.

Example output:

```json
{
  "browserStorage": {
    "https://example.com": {
      "cookies": {
        "unset": {
          "old_session": "network"
        },
        "set": {
          "sessionid": "polling",
          "analytics_id": "network"
        }
      },
      "localStorage": {
        "unset": {
          "temporary_flag": "polling"
        },
        "set": {
          "theme": "polling"
        }
      },
      "sessionStorage": {
        "unset": {},
        "set": {
          "tab_id": "polling"
        }
      }
    }
  }
}
```
