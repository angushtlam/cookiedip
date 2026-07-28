import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cookieHeaderEvents,
  createBrowserProfile,
  DEFAULT_USER_AGENT,
  killPuppeteerBrowserProcess,
  languagePreference,
  localeLanguages,
  normalizeUrl,
  puppeteerLaunchArgs,
  puppeteerLaunchOptions,
  redactSetCookieHeader,
  resolveBrowserUserAgent,
  resolvePuppeteerExecutablePath,
  validatePublicUrl,
} from '../src/browserStorageScanner.js';
import { parseCommandLineArgs } from '../src/cli.js';

test('normalizeUrl adds https when the protocol is omitted', () => {
  assert.equal(normalizeUrl('example.com').href, 'https://example.com/');
});

test('validatePublicUrl rejects loopback and private networks', () => {
  assert.throws(() => validatePublicUrl(new URL('http://127.0.0.1:8000')), /loopback/);
  assert.throws(() => validatePublicUrl(new URL('http://192.168.1.5')), /Private network/);
});

test('cookieHeaderEvents includes the redacted Set-Cookie response header on every event', () => {
  const setCookieHeader = 'session_id=abc123; Path=/; HttpOnly, retired=; Max-Age=0; Path=/';
  const redactedSetCookieHeader =
    'session_id=[redacted]; Path=/; HttpOnly, retired=[redacted]; Max-Age=0; Path=/';

  assert.deepEqual(cookieHeaderEvents('https://example.com/account', setCookieHeader, 81), [
    {
      origin: 'https://example.com',
      storageType: 'cookies',
      name: 'session_id',
      action: 'set',
      evidenceSource: 'cookie-header',
      setCookieHeader: redactedSetCookieHeader,
      observedAt: 81,
    },
    {
      origin: 'https://example.com',
      storageType: 'cookies',
      name: 'retired',
      action: 'remove',
      evidenceSource: 'cookie-header',
      setCookieHeader: redactedSetCookieHeader,
      observedAt: 81,
    },
  ]);
});

test('redactSetCookieHeader removes cookie values and preserves attributes', () => {
  const header = [
    'session=abc=def; Path=/; HttpOnly',
    'expiry=value; Expires=Wed, 21 Oct 2030 07:28:00 GMT; SameSite=Lax',
    'empty=; Secure',
  ].join('\n');

  const redacted = redactSetCookieHeader(header);

  assert.equal(
    redacted,
    'session=[redacted]; Path=/; HttpOnly, expiry=[redacted]; Expires=Wed, 21 Oct 2030 07:28:00 GMT; SameSite=Lax, empty=[redacted]; Secure'
  );
  assert.doesNotMatch(redacted, /abc=def|expiry=value/);
});

test('resolvePuppeteerExecutablePath prefers explicit existing paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cookiedip-puppeteer-test-'));
  const executablePath = join(directory, 'chrome');
  writeFileSync(executablePath, '');

  assert.equal(resolvePuppeteerExecutablePath({}, executablePath), executablePath);
});

test('resolvePuppeteerExecutablePath falls back when configured env path is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cookiedip-puppeteer-test-'));
  const executablePath = join(directory, 'chromium');
  writeFileSync(executablePath, '');

  assert.equal(
    resolvePuppeteerExecutablePath({
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
      PUPPETEER_FALLBACK_EXECUTABLE_PATHS: executablePath,
    }),
    executablePath
  );
});

test('puppeteerLaunchArgs includes sandbox-safe Chromium flags and optional extras', () => {
  assert.deepEqual(puppeteerLaunchArgs({}), [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1365,768',
  ]);

  assert.deepEqual(puppeteerLaunchArgs({}, ['--foo', '--bar']), [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1365,768',
    '--foo',
    '--bar',
  ]);
});

test('puppeteerLaunchOptions suppresses the automation switch and sets a protocol timeout', () => {
  const options = puppeteerLaunchOptions({ env: {} });
  assert.deepEqual(options.ignoreDefaultArgs, ['--enable-automation']);
  assert.equal(options.protocolTimeout, 300000);
  assert.equal(
    puppeteerLaunchOptions({
      env: { PUPPETEER_PROTOCOL_TIMEOUT_MS: '450000' },
    }).protocolTimeout,
    450000
  );
});

test('createBrowserProfile removes the headless token and aligns client hints', () => {
  assert.deepEqual(
    createBrowserProfile({
      browserUserAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/142.0.0.0 Safari/537.36',
      browserVersion: 'Chrome/142.0.7444.175',
      platform: 'Linux x86_64',
      runtimeArchitecture: 'x64',
      runtimePlatform: 'linux',
      runtimeRelease: '6.8.0',
      userAgentMetadata: {
        brands: [
          { brand: 'Not_A Brand', version: '99' },
          { brand: 'Chromium', version: '142' },
        ],
        fullVersionList: [
          { brand: 'Not_A Brand', version: '99.0.0.0' },
          { brand: 'Chromium', version: '142.0.7444.59' },
        ],
        mobile: false,
        platform: 'Linux',
      },
    }),
    {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36',
      platform: 'Linux x86_64',
      userAgentMetadata: {
        brands: [
          { brand: 'Not_A Brand', version: '99' },
          { brand: 'Chromium', version: '142' },
        ],
        fullVersionList: [
          { brand: 'Not_A Brand', version: '99.0.0.0' },
          { brand: 'Chromium', version: '142.0.7444.175' },
        ],
        mobile: false,
        platform: 'Linux',
        platformVersion: '6.8.0',
        architecture: 'x86',
        model: '',
        bitness: '64',
        wow64: false,
      },
    }
  );
});

test('locale helpers create consistent browser languages and request preferences', () => {
  assert.deepEqual(localeLanguages('en-GB'), ['en-GB', 'en']);
  assert.equal(languagePreference('en-GB'), 'en-GB,en;q=0.9');
  assert.deepEqual(localeLanguages(), ['en-US', 'en']);
});

test('Cookiedip preserves its named default user agent', () => {
  assert.equal(
    DEFAULT_USER_AGENT,
    'Mozilla/5.0 (compatible; Cookiedip/1.0; +https://github.com/angushtlam/cookiedip)'
  );
  assert.equal(resolveBrowserUserAgent(), DEFAULT_USER_AGENT);
});

test('Cookiedip resolves custom and installed-browser user agent options', () => {
  assert.equal(resolveBrowserUserAgent({ userAgent: 'MyScanner/2.0' }), 'MyScanner/2.0');
  assert.equal(
    resolveBrowserUserAgent({ browserSettings: { userAgent: 'NestedScanner/3.0' } }),
    'NestedScanner/3.0'
  );
  assert.equal(resolveBrowserUserAgent({ useBrowserUserAgent: true }), null);
});

test('killPuppeteerBrowserProcess logs when a browser process is killed', () => {
  const errors = [];
  const signals = [];
  const killed = killPuppeteerBrowserProcess(
    {
      process() {
        return {
          kill(signal) {
            signals.push(signal);
            return true;
          },
        };
      },
    },
    {
      logger: {
        error(message) {
          errors.push(message);
        },
      },
      normalizedUrl: 'https://example.com/',
      scanTimeoutMs: 1234,
    }
  );

  assert.equal(killed, true);
  assert.deepEqual(signals, ['SIGKILL']);
  assert.match(
    errors.join('\n'),
    /Puppeteer browser killed url=https:\/\/example\.com\/ scanTimeoutMs=1234 signal=SIGKILL killed=true/
  );
});

test('parseCommandLineArgs accepts the legacy browserStorage positional argument', () => {
  assert.deepEqual(
    parseCommandLineArgs(['https://example.com', 'browserStorage', '--capture-window', '2500']),
    {
      help: false,
      options: {
        captureWindowMs: 2500,
        puppeteerArgs: [],
      },
      url: 'https://example.com',
    }
  );
});

test('parseCommandLineArgs accepts a custom user agent', () => {
  assert.equal(
    parseCommandLineArgs(['https://example.com', '--user-agent', 'MyScanner/2.0']).options
      .userAgent,
    'MyScanner/2.0'
  );
});

test('parseCommandLineArgs rejects removed polling flags with migration guidance', () => {
  assert.throws(
    () => parseCommandLineArgs(['https://example.com', '--poll-delay', '1000']),
    /removed in Cookiedip 1\.0\.0/
  );
});
