import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  killPuppeteerBrowserProcess,
  normalizeUrl,
  puppeteerLaunchArgs,
  puppeteerLaunchOptions,
  resolvePuppeteerExecutablePath,
  validatePublicUrl,
} from "../src/browserStorageScanner.js";
import { parseCommandLineArgs } from "../src/cli.js";

test("normalizeUrl adds https when the protocol is omitted", () => {
  assert.equal(normalizeUrl("example.com").href, "https://example.com/");
});

test("validatePublicUrl rejects loopback and private networks", () => {
  assert.throws(() => validatePublicUrl(new URL("http://127.0.0.1:8000")), /loopback/);
  assert.throws(() => validatePublicUrl(new URL("http://192.168.1.5")), /Private network/);
});

test("resolvePuppeteerExecutablePath prefers explicit existing paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "cookiedip-puppeteer-test-"));
  const executablePath = join(directory, "chrome");
  writeFileSync(executablePath, "");

  assert.equal(
    resolvePuppeteerExecutablePath({}, executablePath),
    executablePath,
  );
});

test("resolvePuppeteerExecutablePath falls back when configured env path is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "cookiedip-puppeteer-test-"));
  const executablePath = join(directory, "chromium");
  writeFileSync(executablePath, "");

  assert.equal(
    resolvePuppeteerExecutablePath({
      PUPPETEER_EXECUTABLE_PATH: "/usr/bin/google-chrome-stable",
      PUPPETEER_FALLBACK_EXECUTABLE_PATHS: executablePath,
    }),
    executablePath,
  );
});

test("puppeteerLaunchArgs includes sandbox-safe Chromium flags and optional extras", () => {
  assert.deepEqual(puppeteerLaunchArgs({}), [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
  ]);

  assert.deepEqual(puppeteerLaunchArgs({}, ["--foo", "--bar"]), [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
    "--foo",
    "--bar",
  ]);
});

test("puppeteerLaunchOptions sets an extended protocol timeout", () => {
  assert.equal(puppeteerLaunchOptions({ env: {} }).protocolTimeout, 300000);
  assert.equal(
    puppeteerLaunchOptions({
      env: { PUPPETEER_PROTOCOL_TIMEOUT_MS: "450000" },
    }).protocolTimeout,
    450000,
  );
});

test("killPuppeteerBrowserProcess logs when a browser process is killed", () => {
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
      normalizedUrl: "https://example.com/",
      scanTimeoutMs: 1234,
    },
  );

  assert.equal(killed, true);
  assert.deepEqual(signals, ["SIGKILL"]);
  assert.match(
    errors.join("\n"),
    /Puppeteer browser killed url=https:\/\/example\.com\/ scanTimeoutMs=1234 signal=SIGKILL killed=true/,
  );
});

test("parseCommandLineArgs accepts the legacy browserStorage positional argument", () => {
  assert.deepEqual(
    parseCommandLineArgs([
      "https://example.com",
      "browserStorage",
      "--capture-window",
      "2500",
    ]),
    {
      help: false,
      options: {
        captureWindowMs: 2500,
        puppeteerArgs: [],
      },
      url: "https://example.com",
    },
  );
});

test("parseCommandLineArgs rejects removed polling flags with migration guidance", () => {
  assert.throws(
    () => parseCommandLineArgs(["https://example.com", "--poll-delay", "1000"]),
    /removed in Cookiedip 1\.0\.0/,
  );
});
