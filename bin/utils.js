// Print CLI usage details for cookiedip.
function printUsage() {
  console.log('Usage: cookiedip <url> [type]');
  console.log('type: browserStorage');
  console.log('Defaults to browserStorage.');
}

// Normalize a raw URL string by ensuring it has a valid protocol and absolute form.
// Throws when the URL is missing or cannot be parsed.
function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid URL');
  }

  try {
    return new URL(rawUrl).href;
  } catch {
    if (!/^https?:\/\//i.test(rawUrl)) {
      return new URL(`https://${rawUrl}`).href;
    }
    throw new Error(`Unable to parse URL: ${rawUrl}`);
  }
}

const supportedTypes = ['browserStorage'];

module.exports = {
  printUsage,
  normalizeUrl,
  supportedTypes,
};
