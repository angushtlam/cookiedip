# Repository guidelines for Claude

All functions in this repository should include comments describing their capabilities.

Preferred comment style:
- Describe what the function does.
- Document key inputs (parameters) and expected types.
- Describe the return value or main output.
- Note any important side effects or assumptions.

Example:

```js
// Collects cookies, localStorage, and sessionStorage values from the page.
// page: Puppeteer Page instance.
// Returns an object with cookie, localStorage, and sessionStorage data.
function collectBrowserStorage(page) {
  ...
}
```

This file is repo-specific guidance and is intended to help maintain consistent documentation across the codebase.