import { runBrowserStorageScan } from "./browserStorageScanner.js";

const HELP_TEXT = `Usage: cookiedip <url> [browserStorage] [options]

Scan a public HTTP or HTTPS URL for cookie, localStorage, and sessionStorage activity.

Options:
  --capture-window <ms>        Delay after navigation before collecting results.
  --navigation-timeout <ms>    Navigation timeout in milliseconds.
  --scan-timeout <ms>          Overall scan timeout in milliseconds.
  --locale <value>             Accept-Language override.
  --timezone <value>           Timezone override for Chromium.
  --viewport <width>x<height>  Viewport size, for example 1365x768.
  --user-agent <value>         Override the default user agent.
  --executable-path <path>     Chromium executable path override.
  --puppeteer-arg <value>      Extra Chromium flag. Repeatable.
  -h, --help                   Print usage.

Migration notes:
  --poll-delay and --poll-times were removed in Cookiedip 1.0.0.
  The optional browserStorage positional argument is accepted for compatibility
  but no longer selects a separate implementation.`;

export async function runCli(args, io = defaultIo()) {
  try {
    const parsed = parseCommandLineArgs(args);
    if (parsed.help) {
      io.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }

    const result = await runBrowserStorageScan(parsed.url, parsed.options);
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n`);
    io.stderr.write(`${HELP_TEXT}\n`);
    return io.exitCode(1);
  }
}

export function parseCommandLineArgs(args) {
  const positionals = [];
  const options = { puppeteerArgs: [] };
  let help = false;

  const readOptionValue = (optionName, index) => {
    const next = args[index + 1];
    if (!next || next.startsWith("-")) {
      throw new Error(`Missing value for ${optionName}.`);
    }
    return next;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "--poll-delay" || arg.startsWith("--poll-delay=")) {
      throw new Error("The --poll-delay flag was removed in Cookiedip 1.0.0. Use --capture-window instead.");
    }

    if (arg === "--poll-times" || arg.startsWith("--poll-times=")) {
      throw new Error("The --poll-times flag was removed in Cookiedip 1.0.0. Use --capture-window instead.");
    }

    if (arg === "--capture-window") {
      options.captureWindowMs = parsePositiveInteger(
        readOptionValue(arg, i),
        arg,
      );
      i += 1;
      continue;
    }

    if (arg.startsWith("--capture-window=")) {
      options.captureWindowMs = parsePositiveInteger(
        arg.slice("--capture-window=".length),
        "--capture-window",
      );
      continue;
    }

    if (arg === "--navigation-timeout") {
      options.navigationTimeoutMs = parsePositiveInteger(
        readOptionValue(arg, i),
        arg,
      );
      i += 1;
      continue;
    }

    if (arg.startsWith("--navigation-timeout=")) {
      options.navigationTimeoutMs = parsePositiveInteger(
        arg.slice("--navigation-timeout=".length),
        "--navigation-timeout",
      );
      continue;
    }

    if (arg === "--scan-timeout") {
      options.scanTimeoutMs = parsePositiveInteger(
        readOptionValue(arg, i),
        arg,
      );
      i += 1;
      continue;
    }

    if (arg.startsWith("--scan-timeout=")) {
      options.scanTimeoutMs = parsePositiveInteger(
        arg.slice("--scan-timeout=".length),
        "--scan-timeout",
      );
      continue;
    }

    if (arg === "--locale") {
      options.locale = readOptionValue(arg, i);
      i += 1;
      continue;
    }

    if (arg.startsWith("--locale=")) {
      options.locale = arg.slice("--locale=".length);
      continue;
    }

    if (arg === "--timezone") {
      options.timezone = readOptionValue(arg, i);
      i += 1;
      continue;
    }

    if (arg.startsWith("--timezone=")) {
      options.timezone = arg.slice("--timezone=".length);
      continue;
    }

    if (arg === "--user-agent") {
      options.userAgent = readOptionValue(arg, i);
      i += 1;
      continue;
    }

    if (arg.startsWith("--user-agent=")) {
      options.userAgent = arg.slice("--user-agent=".length);
      continue;
    }

    if (arg === "--executable-path") {
      options.executablePath = readOptionValue(arg, i);
      i += 1;
      continue;
    }

    if (arg.startsWith("--executable-path=")) {
      options.executablePath = arg.slice("--executable-path=".length);
      continue;
    }

    if (arg === "--viewport") {
      options.viewport = parseViewport(readOptionValue(arg, i));
      i += 1;
      continue;
    }

    if (arg.startsWith("--viewport=")) {
      options.viewport = parseViewport(arg.slice("--viewport=".length));
      continue;
    }

    if (arg === "--puppeteer-arg") {
      options.puppeteerArgs.push(readOptionValue(arg, i));
      i += 1;
      continue;
    }

    if (arg.startsWith("--puppeteer-arg=")) {
      options.puppeteerArgs.push(arg.slice("--puppeteer-arg=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unsupported option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (help && positionals.length === 0) {
    return { help: true, options, url: null };
  }

  if (positionals.length === 0) {
    throw new Error("URL is required.");
  }

  if (positionals.length > 2) {
    throw new Error(`Unexpected argument(s): ${positionals.slice(2).join(", ")}`);
  }

  const [url, legacyMode] = positionals;
  if (legacyMode && legacyMode !== "browserStorage") {
    throw new Error(`Unsupported positional argument: ${legacyMode}`);
  }

  return {
    help,
    options,
    url,
  };
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseViewport(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error("--viewport must use WIDTHxHEIGHT, for example 1365x768.");
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function errorMessage(error) {
  return error instanceof Error ? `Error: ${error.message}` : "Error: Unknown error.";
}

function defaultIo() {
  return {
    exitCode(code) {
      process.exitCode = code;
      return code;
    },
    stderr: process.stderr,
    stdout: process.stdout,
  };
}
