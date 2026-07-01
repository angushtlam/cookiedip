import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_CAPTURE_WINDOW_MS = 5000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 50000;
export const DEFAULT_SCAN_TIMEOUT_MS = 100000;
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; Cookiedip/1.0; +https://github.com/angushtlam/cookiedip)";
const DEFAULT_VIEWPORT = { width: 1365, height: 768 };
const WORKER_TIMEOUT_GRACE_MS = 5000;
const browserWorkers = new Map();
let nextWorkerRequestId = 0;

export function runBrowserStorageScanInWorker(submittedUrl, options = {}) {
  const normalizedUrl = resolveNormalizedUrl(submittedUrl, options);
  const scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  const workerKey = browserWorkerKey(options);
  const workerOptions = { ...options, normalizedUrl };
  delete workerOptions.logger;

  return sendBrowserWorkerRequest({
    workerKey,
    message: {
      type: "cookiedip-browser-storage-scan-request",
      submittedUrl,
      normalizedUrl,
      options: workerOptions,
    },
    timeoutMs: scanTimeoutMs + WORKER_TIMEOUT_GRACE_MS,
    timeoutMessage: `Scan timed out after ${scanTimeoutMs}ms; browser worker was killed.`,
    responseType: "cookiedip-browser-storage-scan-result",
  });
}

export function warmBrowserStorageWorker(options = {}) {
  const workerKey = browserWorkerKey(options);
  const timeoutMs = Number(
    options.timeoutMs || process.env.PUPPETEER_WARMUP_TIMEOUT_MS || 300000,
  );

  return sendBrowserWorkerRequest({
    workerKey,
    message: {
      type: "cookiedip-browser-storage-browser-warmup",
      normalizedUrl: options.normalizedUrl || "about:blank",
      options: {},
    },
    timeoutMs,
    timeoutMessage: `Puppeteer browser warmup timed out after ${timeoutMs}ms.`,
    responseType: "cookiedip-browser-storage-browser-ready",
  });
}

function sendBrowserWorkerRequest({
  workerKey,
  message,
  timeoutMs,
  timeoutMessage,
  responseType,
}) {
  const worker = getBrowserWorker(workerKey);
  const requestId = `${Date.now()}-${++nextWorkerRequestId}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.pending.delete(requestId);
      stopBrowserWorker(workerKey);
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    timeout.unref?.();

    worker.pending.set(requestId, {
      resolve,
      reject,
      timeout,
      responseType,
    });

    worker.child.send({
      ...message,
      requestId,
    });
  });
}

export async function closeBrowserStorageWorkers() {
  await Promise.allSettled(
    [...browserWorkers.keys()].map((workerKey) => stopBrowserWorker(workerKey)),
  );
}

function getBrowserWorker(workerKey) {
  const existing = browserWorkers.get(workerKey);
  if (existing && existing.child.connected) return existing;

  const workerPath = fileURLToPath(new URL("./browserWorker.js", import.meta.url));
  const child = fork(workerPath, [], {
    env: {
      ...process.env,
      COOKIEDIP_BROWSER_WORKER_KEY: workerKey,
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const worker = {
    child,
    pending: new Map(),
  };
  browserWorkers.set(workerKey, worker);

  child.on("message", (message) => {
    const pending = worker.pending.get(message.requestId);
    if (!pending) return;
    if (message?.type !== pending.responseType) return;

    worker.pending.delete(message.requestId);
    clearTimeout(pending.timeout);

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(browserWorkerErrorMessage(message)));
  });

  child.once("error", (error) => {
    rejectPendingWorkerRequests(worker, error);
    browserWorkers.delete(workerKey);
  });

  child.once("exit", (code, signal) => {
    browserWorkers.delete(workerKey);
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    rejectPendingWorkerRequests(
      worker,
      new Error(`Browser worker exited before returning a result: ${reason}.`),
    );
  });

  return worker;
}

function stopBrowserWorker(workerKey) {
  const worker = browserWorkers.get(workerKey);
  if (!worker) return Promise.resolve();
  browserWorkers.delete(workerKey);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error(
        `Cookiedip browser worker killed workerKey=${workerKey} signal=SIGKILL`,
      );
      worker.child.kill("SIGKILL");
      resolve();
    }, 5000);
    timeout.unref?.();

    worker.child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    if (worker.child.connected) {
      worker.child.send({ type: "cookiedip-browser-storage-scan-shutdown" });
      return;
    }

    worker.child.kill("SIGTERM");
  });
}

function rejectPendingWorkerRequests(worker, error) {
  for (const [requestId, pending] of worker.pending) {
    worker.pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
}

function browserWorkerKey(options) {
  return String(options.browserWorkerKey || options.region || "default");
}

function browserWorkerErrorMessage(message) {
  if (typeof message?.error === "string" && message.error.trim()) {
    return message.error.trim();
  }

  try {
    return `Browser worker failed without an error message: ${JSON.stringify(message)}`;
  } catch {
    return "Browser worker failed without an error message.";
  }
}

export async function runBrowserStorageScan(submittedUrl, options = {}) {
  const normalizedUrl = resolveNormalizedUrl(submittedUrl, options);
  const captureWindowMs =
    options.captureWindowMs ?? DEFAULT_CAPTURE_WINDOW_MS;
  const navigationTimeoutMs =
    options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  const scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  const logger = options.logger ?? console;
  const browserSettings = resolveBrowserSettings(options);
  let browser = options.browser || null;
  let ownsBrowser = false;
  let scanTimeout = null;
  const events = [];
  const browserStartedAt = performance.now();
  const browserStartedAtEpochMs = Date.now();
  const runTimestamp = new Date(browserStartedAtEpochMs).toISOString();

  try {
    scanTimeout = setTimeout(() => {
      killPuppeteerBrowserProcess(browser, {
        logger,
        normalizedUrl,
        scanTimeoutMs,
      });
    }, scanTimeoutMs);
    scanTimeout.unref?.();

    if (browser) {
      logInfo(
        logger,
        `Reusing Puppeteer browser url=${normalizedUrl} navigationTimeoutMs=${navigationTimeoutMs} captureWindowMs=${captureWindowMs}`,
      );
    } else {
      browser = await launchBrowserForStorageScan({
        logger,
        startedAt: browserStartedAt,
        normalizedUrl,
        executablePath: browserSettings.executablePath,
        puppeteerArgs: browserSettings.puppeteerArgs,
      });
      ownsBrowser = true;
    }

    if (!ownsBrowser) {
      await Promise.race([clearBrowserState(browser), delay(5000)]).catch(() => {});
    }

    const page = await browser.newPage();
    let cdpDetach = null;

    try {
      page.setDefaultNavigationTimeout(navigationTimeoutMs);
      page.setDefaultTimeout(navigationTimeoutMs);

      await page.setViewport(browserSettings.viewport);
      await page.setUserAgent(browserSettings.userAgent);
      await applyBrowserSettings(page, browserSettings);
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.clear();
        } catch {}
        try {
          sessionStorage.clear();
        } catch {}
      });
      await installStorageHook(page, events, browserStartedAtEpochMs);
      cdpDetach = await installCdpDomStorageMonitor(
        page,
        events,
        browserStartedAtEpochMs,
      );
      setupNetworkMonitor(page, events, browserStartedAtEpochMs);

      await page.goto(normalizedUrl, {
        waitUntil: "load",
        timeout: navigationTimeoutMs,
      });

      const finalUrl = page.url();
      validatePublicUrl(normalizeUrl(finalUrl));
      logInfo(
        logger,
        `Puppeteer navigation completed url=${normalizedUrl} finalUrl=${finalUrl} elapsedMs=${Math.round(performance.now() - browserStartedAt)}`,
      );

      await delay(captureWindowMs);

      const items = buildItems(events);
      const browserDuration = Math.round(performance.now() - browserStartedAt);
      const lastEventDetectedInRun = getLastEventDetectedInRun(events);
      logInfo(
        logger,
        `Puppeteer scan completed url=${normalizedUrl} finalUrl=${finalUrl} durationMs=${browserDuration} items=${items.length} events=${events.length}`,
      );

      return {
        submittedUrl,
        normalizedUrl,
        finalUrl,
        runTimestamp,
        browserDuration,
        lastEventDetectedInRun,
        items,
        events,
      };
    } finally {
      cdpDetach?.();
      await page.close().catch(() => {});
    }
  } finally {
    if (scanTimeout) {
      clearTimeout(scanTimeout);
    }
    if (browser && ownsBrowser) {
      await browser.close().catch(() => {});
      logInfo(
        logger,
        `Puppeteer browser closed url=${normalizedUrl} elapsedMs=${Math.round(performance.now() - browserStartedAt)}`,
      );
    }
  }
}

export function killPuppeteerBrowserProcess(
  browser,
  { logger = console, normalizedUrl = "unknown", scanTimeoutMs = 0 } = {},
) {
  const process = browser?.process?.();
  if (!process) {
    logError(
      logger,
      `Puppeteer scan timed out url=${normalizedUrl} scanTimeoutMs=${scanTimeoutMs}; no browser process was available to kill`,
    );
    return false;
  }

  const killed = process.kill("SIGKILL");
  logError(
    logger,
    `Puppeteer browser killed url=${normalizedUrl} scanTimeoutMs=${scanTimeoutMs} signal=SIGKILL killed=${killed}`,
  );
  return killed;
}

export async function launchBrowserForStorageScan({
  logger = console,
  startedAt = performance.now(),
  normalizedUrl = "about:blank",
  executablePath,
  puppeteerArgs,
} = {}) {
  const resolvedExecutablePath = resolvePuppeteerExecutablePath(
    process.env,
    executablePath,
  );
  if (!resolvedExecutablePath && process.env.PUPPETEER_EXECUTABLE_PATH) {
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const { default: puppeteer } = await import("puppeteer");

  logInfo(
    logger,
    `Starting Puppeteer browser executable=${resolvedExecutablePath || "bundled"} url=${normalizedUrl}`,
  );

  const browser = await puppeteer.launch(
    puppeteerLaunchOptions({
      executablePath: resolvedExecutablePath,
      puppeteerArgs,
    }),
  );

  logInfo(
    logger,
    `Puppeteer browser launched url=${normalizedUrl} elapsedMs=${Math.round(performance.now() - startedAt)}`,
  );

  return browser;
}

export function puppeteerLaunchOptions({
  executablePath,
  env = process.env,
  puppeteerArgs,
} = {}) {
  return {
    headless: "new",
    executablePath,
    args: puppeteerLaunchArgs(env, puppeteerArgs),
    protocolTimeout: Number(env.PUPPETEER_PROTOCOL_TIMEOUT_MS || 300000),
  };
}

function logInfo(logger, message) {
  if (typeof logger?.info === "function") {
    logger.info(message);
  }
}

function logError(logger, message) {
  if (typeof logger?.error === "function") {
    logger.error(message);
  }
}

export function puppeteerLaunchArgs(env = process.env, puppeteerArgs) {
  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
  ];

  if ((env.PUPPETEER_SINGLE_PROCESS || "1") === "1") {
    baseArgs.push("--single-process");
  }

  const configuredArgs = Array.isArray(puppeteerArgs)
    ? puppeteerArgs
    : typeof env.PUPPETEER_EXTRA_ARGS === "string"
      ? env.PUPPETEER_EXTRA_ARGS.split(/\s+/)
      : [];

  return [
    ...baseArgs,
    ...configuredArgs.map((arg) => String(arg).trim()).filter(Boolean),
  ];
}

export function resolvePuppeteerExecutablePath(
  env = process.env,
  configuredPath,
) {
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  const executablePath = env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath && existsSync(executablePath)) return executablePath;

  for (const fallbackPath of puppeteerExecutableFallbacks(env)) {
    if (existsSync(fallbackPath)) return fallbackPath;
  }

  return undefined;
}

function puppeteerExecutableFallbacks(env) {
  if (env.PUPPETEER_FALLBACK_EXECUTABLE_PATHS !== undefined) {
    return env.PUPPETEER_FALLBACK_EXECUTABLE_PATHS
      .split(":")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
  ];
}

export function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    throw new Error("URL is required.");
  }

  try {
    return new URL(trimmed);
  } catch {
    if (!/^https?:\/\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`);
    }
    throw new Error("Unable to parse URL.");
  }
}

export function validatePublicUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  ) {
    throw new Error("Localhost and loopback URLs are not allowed.");
  }

  if (isPrivateIpv4(hostname)) {
    throw new Error("Private network URLs are not allowed.");
  }
}

function resolveNormalizedUrl(submittedUrl, options) {
  if (typeof options.normalizedUrl === "string" && options.normalizedUrl) {
    return options.normalizedUrl;
  }

  const normalizedUrl = normalizeUrl(submittedUrl);
  validatePublicUrl(normalizedUrl);
  return normalizedUrl.href;
}

function resolveBrowserSettings(options) {
  const viewport = normalizeViewport(
    options.viewport || options.browserSettings?.viewport,
  );

  return {
    executablePath:
      options.executablePath || options.browserSettings?.executablePath,
    locale: options.locale || options.browserSettings?.locale,
    timezone: options.timezone || options.browserSettings?.timezone,
    puppeteerArgs:
      options.puppeteerArgs || options.browserSettings?.puppeteerArgs || [],
    userAgent: options.userAgent || options.browserSettings?.userAgent || DEFAULT_USER_AGENT,
    viewport,
  };
}

function normalizeViewport(viewport) {
  if (!viewport) return { ...DEFAULT_VIEWPORT };
  if (
    Number.isInteger(viewport.width) &&
    viewport.width > 0 &&
    Number.isInteger(viewport.height) &&
    viewport.height > 0
  ) {
    return {
      width: viewport.width,
      height: viewport.height,
    };
  }

  throw new Error("Viewport must include positive integer width and height values.");
}

async function applyBrowserSettings(page, browserSettings) {
  if (browserSettings.locale) {
    await page.setExtraHTTPHeaders({
      "Accept-Language": browserSettings.locale,
    });
  }

  if (browserSettings.timezone) {
    const client = await page.createCDPSession();
    try {
      await client.send("Emulation.setTimezoneOverride", {
        timezoneId: browserSettings.timezone,
      });
    } finally {
      await client.detach().catch(() => {});
    }
  }
}

async function installStorageHook(page, events, browserStartedAtEpochMs) {
  await page.exposeFunction("__cookiedipRecordStorageEvent", (event) => {
    if (!isStorageEvent(event)) return;
    events.push(event);
  });

  await page.evaluateOnNewDocument((scanStartedAtEpochMs) => {
    const observedAt = () =>
      Math.max(0, Math.round(Date.now() - scanStartedAtEpochMs));

    const record = (event) => {
      const recorder = window.__cookiedipRecordStorageEvent;
      if (typeof recorder === "function") {
        try {
          recorder(event);
        } catch {}
      }
    };

    const storageTypeFor = (storageArea) => {
      if (storageArea === window.localStorage) return "localStorage";
      if (storageArea === window.sessionStorage) return "sessionStorage";
      return null;
    };

    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;

    Storage.prototype.setItem = function patchedSetItem(key, value) {
      const storageType = storageTypeFor(this);
      if (storageType) {
        record({
          origin: window.location.origin,
          storageType,
          name: String(key),
          action: "set",
          evidenceSource: "js-monkeypatch-intercept",
          observedAt: observedAt(),
        });
      }

      return originalSetItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      const storageType = storageTypeFor(this);
      if (storageType) {
        record({
          origin: window.location.origin,
          storageType,
          name: String(key),
          action: "remove",
          evidenceSource: "js-monkeypatch-intercept",
          observedAt: observedAt(),
        });
      }

      return originalRemoveItem.call(this, key);
    };

    Storage.prototype.clear = function patchedClear() {
      const storageType = storageTypeFor(this);
      if (storageType) {
        record({
          origin: window.location.origin,
          storageType,
          name: "*",
          action: "clear",
          evidenceSource: "js-monkeypatch-intercept",
          observedAt: observedAt(),
        });
      }

      return originalClear.call(this);
    };

    const cookieDescriptor =
      Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ||
      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

    if (cookieDescriptor?.get && cookieDescriptor?.set) {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get() {
          return cookieDescriptor.get?.call(document);
        },
        set(value) {
          const cookieName = String(value).split("=")[0]?.trim();
          if (cookieName) {
            record({
              origin: window.location.origin,
              storageType: "cookies",
              name: cookieName,
              action: isCookieUnset(String(value)) ? "remove" : "set",
              evidenceSource: "js-monkeypatch-intercept",
              observedAt: observedAt(),
            });
          }

          return cookieDescriptor.set?.call(document, value);
        },
      });
    }
  }, browserStartedAtEpochMs);
}

async function installCdpDomStorageMonitor(page, events, browserStartedAtEpochMs) {
  const browser = page.browser();
  const attachedTargets = new WeakSet();
  const clients = new Set();

  const recordCdpEvent = (storageId, name, action) => {
    if (
      typeof storageId.securityOrigin !== "string" ||
      typeof name !== "string"
    ) {
      return;
    }

    events.push({
      origin: storageId.securityOrigin,
      storageType: storageId.isLocalStorage ? "localStorage" : "sessionStorage",
      name,
      action,
      evidenceSource: "cdp-storage-intercept",
      observedAt: relativeTimestamp(browserStartedAtEpochMs),
    });
  };

  const attachTarget = async (target) => {
    if (attachedTargets.has(target) || !isDomStorageTarget(target)) {
      return;
    }

    attachedTargets.add(target);

    try {
      const client = await target.createCDPSession();
      await client.send("DOMStorage.enable");
      clients.add(client);

      client.on("DOMStorage.domStorageItemAdded", (event) => {
        recordCdpEvent(event.storageId, event.key, "set");
      });

      client.on("DOMStorage.domStorageItemUpdated", (event) => {
        recordCdpEvent(event.storageId, event.key, "set");
      });

      client.on("DOMStorage.domStorageItemRemoved", (event) => {
        recordCdpEvent(event.storageId, event.key, "remove");
      });

      client.on("DOMStorage.domStorageItemsCleared", (event) => {
        recordCdpEvent(event.storageId, "*", "clear");
      });
    } catch {}
  };

  const handleTargetCreated = (target) => {
    attachTarget(target).catch(() => {});
  };

  browser.on("targetcreated", handleTargetCreated);
  await Promise.all(browser.targets().map((target) => attachTarget(target)));

  return () => {
    browser.off("targetcreated", handleTargetCreated);
    clients.forEach((client) => {
      client.detach().catch(() => {});
    });
  };
}

function isDomStorageTarget(target) {
  return target.type() === "page" || target.type() === "iframe";
}

function setupNetworkMonitor(page, events, browserStartedAtEpochMs) {
  page.on("response", async (response) => {
    try {
      const headers = response.headers();
      const setCookieHeader = headers["set-cookie"];
      if (!setCookieHeader) return;

      const origin = getUrlOrigin(response.url());
      if (!origin) return;

      parseSetCookieHeader(setCookieHeader).forEach((cookieString) => {
        const cookieName = cookieString.trim().match(/^([^=;\s]+)=/)?.[1];
        if (!cookieName) return;

        events.push({
          origin,
          storageType: "cookies",
          name: cookieName,
          action: isCookieUnset(cookieString) ? "remove" : "set",
          evidenceSource: "cookie-header",
          observedAt: relativeTimestamp(browserStartedAtEpochMs),
        });
      });
    } catch {}
  });
}

function buildItems(events) {
  const candidates = new Map();

  const ensureItem = (origin, storageType, name) => {
    const key = `${origin}\u0000${storageType}\u0000${name}`;
    const existing = candidates.get(key);
    if (existing) return existing;

    const item = {
      origin,
      storageType,
      name,
      lastKnownState: "absent",
      evidenceSources: [],
    };
    candidates.set(key, item);
    return item;
  };

  events.forEach((event) => {
    if (event.name === "*") return;
    const item = ensureItem(event.origin, event.storageType, event.name);
    updateLastKnownState(item, event);
    addEvidenceSource(item, event.evidenceSource);
  });

  return [...candidates.values()]
    .map(({ lastObservedAt, ...item }) => item)
    .sort((a, b) =>
      `${a.origin}:${a.storageType}:${a.name}`.localeCompare(
        `${b.origin}:${b.storageType}:${b.name}`,
      ),
    );
}

function updateLastKnownState(item, event) {
  const observedAt = event.observedAt;
  const currentObservedAt = item.lastObservedAt;

  if (!Number.isFinite(observedAt)) {
    return;
  }

  if (
    item.lastObservedAt === undefined ||
    !Number.isFinite(currentObservedAt) ||
    observedAt >= currentObservedAt
  ) {
    item.lastKnownState = event.action === "set" ? "present" : "absent";
    item.lastObservedAt = event.observedAt;
  }
}

function getLastEventDetectedInRun(events) {
  const stateByKey = new Map();
  let lastEventDetectedInRun = null;

  events.forEach((event) => {
    if (!Number.isFinite(event.observedAt)) {
      return;
    }

    if (event.action === "clear") {
      lastEventDetectedInRun = event.observedAt;
      return;
    }

    const key = `${event.origin}\u0000${event.storageType}\u0000${event.name}`;
    const currentState = stateByKey.get(key) || "absent";
    const nextState = event.action === "set" ? "present" : "absent";

    if (currentState !== nextState) {
      stateByKey.set(key, nextState);
      lastEventDetectedInRun = event.observedAt;
    }
  });

  return lastEventDetectedInRun;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function parseSetCookieHeader(header) {
  return header
    .split(/,(?=\s*[^=;\s]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCookieUnset(cookieValue) {
  return /(?:max-age\s*=\s*0)|(?:expires\s*=\s*[^;]*(1970|Thu, 01 Jan 1970|01 Jan 1970))/i.test(
    cookieValue,
  );
}

function getUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function relativeTimestamp(startedAtEpochMs) {
  return Math.max(0, Math.round(Date.now() - startedAtEpochMs));
}

function addEvidenceSource(item, evidenceSource) {
  if (!item.evidenceSources.includes(evidenceSource)) {
    item.evidenceSources.push(evidenceSource);
  }
}

function isStorageEvent(value) {
  if (!value || typeof value !== "object") return false;
  return (
    typeof value.origin === "string" &&
    isStorageType(value.storageType) &&
    typeof value.name === "string" &&
    isStorageAction(value.action) &&
    isEvidenceSource(value.evidenceSource) &&
    Number.isFinite(value.observedAt)
  );
}

function isStorageType(value) {
  return (
    value === "cookies" ||
    value === "localStorage" ||
    value === "sessionStorage"
  );
}

function isStorageAction(value) {
  return value === "set" || value === "remove" || value === "clear";
}

function isEvidenceSource(value) {
  return (
    value === "js-monkeypatch-intercept" ||
    value === "cdp-storage-intercept" ||
    value === "cookie-header"
  );
}

async function clearBrowserState(browser) {
  const page = await browser.newPage();
  try {
    const client = await page.createCDPSession();
    try {
      await Promise.all([
        client.send("Network.clearBrowserCookies"),
        client.send("Network.clearBrowserCache"),
      ]);
    } finally {
      await client.detach().catch(() => {});
    }
  } finally {
    await page.close().catch(() => {});
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
