// Collects cookie and storage keys from all frame origins.
// page: Puppeteer Page instance.
// Returns an object keyed by frame origin URI, with each value containing cookie and storage evidence maps.
async function collectBrowserStorage(
  page,
  networkData = null,
  { pollDelayMs = 1000, pollTimes = 5 } = {},
) {
  const result = {};

  const createOriginResult = () => ({
    cookies: {
      unset: {},
      set: {},
    },
    localStorage: {
      unset: {},
      set: {},
    },
    sessionStorage: {
      unset: {},
      set: {},
    },
  });

  const ensureOrigin = (origin) => {
    if (!result[origin]) {
      result[origin] = createOriginResult();
    }
    return result[origin];
  };

  const getUrlOrigin = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  const createPollSnapshot = () => ({});

  const ensureSnapshotOrigin = (snapshot, origin) => {
    if (!snapshot[origin]) {
      snapshot[origin] = {
        cookies: new Set(),
        localStorage: new Set(),
        sessionStorage: new Set(),
      };
    }
    return snapshot[origin];
  };

  const collectPollSnapshot = async () => {
    const snapshot = createPollSnapshot();

    const allCookies = await page.cookies();
    allCookies.forEach((cookie) => {
      // Cookie domains may be returned with a leading period; treat those as the same site.
      const domain = cookie.domain.replace(/^\./, '');
      const origin = `${cookie.secure ? 'https' : 'http'}://${domain}`;
      ensureSnapshotOrigin(snapshot, origin).cookies.add(cookie.name);
    });

    const frames = page.frames();
    for (const frame of frames) {
      try {
        const frameOrigin = getUrlOrigin(frame.url());
        if (!frameOrigin) continue;

        const storage = await frame.evaluate(() => {
          const getKeys = (storageArea) => {
            const result = [];
            for (let i = 0; i < storageArea.length; i += 1) {
              const key = storageArea.key(i);
              result.push(key);
            }
            return result;
          };

          return {
            localStorage: getKeys(window.localStorage),
            sessionStorage: getKeys(window.sessionStorage),
          };
        });

        const originSnapshot = ensureSnapshotOrigin(snapshot, frameOrigin);
        storage.localStorage.forEach((key) => originSnapshot.localStorage.add(key));
        storage.sessionStorage.forEach((key) => originSnapshot.sessionStorage.add(key));
      } catch {
        // Skip frames that are inaccessible or cross-origin
      }
    }

    return snapshot;
  };

  const applyPollingEvidence = (snapshots) => {
    const finalSnapshot = snapshots[snapshots.length - 1] || {};
    const origins = new Set();
    snapshots.forEach((snapshot) => {
      Object.keys(snapshot).forEach((origin) => origins.add(origin));
    });

    origins.forEach((origin) => {
      const originResult = ensureOrigin(origin);
      ['cookies', 'localStorage', 'sessionStorage'].forEach((bucketName) => {
        const allKeys = new Set();
        snapshots.forEach((snapshot) => {
          (snapshot[origin]?.[bucketName] || new Set()).forEach((key) => allKeys.add(key));
        });

        allKeys.forEach((key) => {
          const wasSetAtFinalPoll = finalSnapshot[origin]?.[bucketName]?.has(key);
          if (wasSetAtFinalPoll) {
            originResult[bucketName].set[key] = 'polling';
          } else {
            originResult[bucketName].unset[key] = 'polling';
          }
        });
      });
    });
  };

  const snapshots = [];
  for (let i = 0; i < pollTimes; i += 1) {
    snapshots.push(await collectPollSnapshot());
    if (i < pollTimes - 1) {
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
  }

  applyPollingEvidence(snapshots);

  // Merge cookie changes observed from response headers.
  (networkData?.responses || []).forEach((response) => {
    const origin = getUrlOrigin(response.url);
    if (!origin) return;

    const originResult = ensureOrigin(origin);
    response.cookiesSet.forEach((cookieName) => {
      originResult.cookies.set[cookieName] = 'network';
    });
    response.cookiesUnset.forEach((cookieName) => {
      originResult.cookies.unset[cookieName] = 'network';
    });
  });

  return result;
}

module.exports = collectBrowserStorage;
