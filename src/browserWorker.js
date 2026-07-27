import { fileURLToPath } from "node:url";

import {
  launchBrowserForStorageScan,
  runBrowserStorageScan,
} from "./browserStorageScanner.js";

export function startBrowserStorageWorker() {
  let browser = null;
  let browserPromise = null;
  let shuttingDown = false;
  const workerKey = process.env.COOKIEDIP_BROWSER_WORKER_KEY || "default";

  process.on("message", async (message) => {
    if (message?.type === "cookiedip-browser-storage-scan-shutdown") {
      await shutdown();
      return;
    }

    if (message?.type === "cookiedip-browser-storage-browser-warmup") {
      await warmupBrowser(message);
      return;
    }

    if (message?.type !== "cookiedip-browser-storage-scan-request") return;
    const scanMessage = message;

    try {
      const persistentBrowser = await getBrowser(scanMessage);
      const result = await runBrowserStorageScan(scanMessage.submittedUrl, {
        ...scanMessage.options,
        browser: persistentBrowser,
        logger: console,
      });
      process.send?.({
        type: "cookiedip-browser-storage-scan-result",
        requestId: scanMessage.requestId,
        ok: true,
        result,
      });
    } catch (error) {
      const message = errorMessage(error);
      console.error(`Cookiedip browser storage worker failed worker=${workerKey}: ${message}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      await recycleBrowser();
      process.send?.({
        type: "cookiedip-browser-storage-scan-result",
        requestId: scanMessage.requestId,
        ok: false,
        error: message,
        stack: error instanceof Error ? error.stack : null,
      });
    }
  });

  process.on("error", (error) => {
    if (
      error?.code === "ERR_IPC_CHANNEL_CLOSED" ||
      error?.code === "ERR_IPC_DISCONNECTED"
    ) {
      if (!shuttingDown) shutdown().catch(() => process.exit(1));
      return;
    }

    throw error;
  });

  process.once("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.once("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });

  async function getBrowser(message) {
    if (browser?.connected) return browser;
    if (!browserPromise) {
      browserPromise = launchBrowserForStorageScan({
        logger: console,
        normalizedUrl: message.normalizedUrl,
        executablePath: message.options?.executablePath,
        puppeteerArgs: message.options?.puppeteerArgs,
      }).then(
        (launchedBrowser) => {
          browser = launchedBrowser;
          browserPromise = null;
          return launchedBrowser;
        },
        (error) => {
          browserPromise = null;
          throw error;
        },
      );
    }

    return browserPromise;
  }

  async function warmupBrowser(message) {
    try {
      await getBrowser(message);
      process.send?.({
        type: "cookiedip-browser-storage-browser-ready",
        requestId: message.requestId,
        ok: true,
        workerKey,
      });
    } catch (error) {
      const errorText = errorMessage(error);
      console.error(`Cookiedip browser warmup failed worker=${workerKey}: ${errorText}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      await recycleBrowser();
      process.send?.({
        type: "cookiedip-browser-storage-browser-ready",
        requestId: message.requestId,
        ok: false,
        workerKey,
        error: errorText,
        stack: error instanceof Error ? error.stack : null,
      });
    }
  }

  async function recycleBrowser() {
    const currentBrowser = browser;
    browser = null;
    browserPromise = null;
    await currentBrowser?.close().catch(() => {});
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await recycleBrowser();
    process.exit(0);
  }
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Browser scan failed.";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBrowserStorageWorker();
}
