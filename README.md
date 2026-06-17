# cookiedip

`cookiedip` is a simple Node.js command-line tool that loads a website in headless Chrome and returns the cookies set by the page after all assets are loaded.

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

You can pass a single output type explicitly:

```bash
npx cookiedip https://example.com browserStorage
```

## Output

For `browserStorage`, the CLI prints an object containing cookies, localStorage, sessionStorage, and network cookie set/unset activity.

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

## Notes

- The CLI uses `puppeteer` and launches a headless Chromium instance.
- It waits for the page load event and network idle before collecting cookies.
