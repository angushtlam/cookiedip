// Registers a response listener on a page that collects response URLs and tracks cookie changes.
// page: Puppeteer Page instance.
// Returns an object with a handler for removing the listener and a responses array.
function setupNetworkMonitor(page) {
  const responses = [];

  const parseCookieNames = (setCookieHeader) => {
    const cookieNames = [];
    const parts = setCookieHeader.split(/,(?=\s*[^=;\s]+=)/);

    parts.forEach((part) => {
      const match = part.trim().match(/^([^=;\s]+)=/);
      if (match) {
        cookieNames.push(match[1]);
      }
    });

    return cookieNames;
  };

  const parseCookieAction = (cookieString) => {
    const nameMatch = cookieString.trim().match(/^([^=;\s]+)=/);
    if (!nameMatch) {
      return null;
    }
    const name = nameMatch[1];
    const lower = cookieString.toLowerCase();
    const isUnset =
      /(?:max-age\s*=\s*0)|(?:expires\s*=\s*[^;]*(1970|Thu, 01 Jan 1970|01 Jan 1970))/i.test(lower);
    return { name, action: isUnset ? 'unset' : 'set' };
  };

  const responseHandler = async (response) => {
    try {
      const responseUrl = response.url();
      const responseHeaders = response.headers();
      const setCookieHeader = responseHeaders['set-cookie'];
      if (!setCookieHeader) {
        return;
      }

      const cookies = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : parseCookieNames(setCookieHeader).map((name) => `${name}=`);

      const cookiesSet = [];
      const cookiesUnset = [];

      cookies.forEach((cookieString) => {
        const parsed = parseCookieAction(cookieString);
        if (!parsed) {
          return;
        }
        if (parsed.action === 'unset') {
          cookiesUnset.push(parsed.name);
        } else {
          cookiesSet.push(parsed.name);
        }
      });

      if (cookiesSet.length > 0 || cookiesUnset.length > 0) {
        responses.push({
          url: responseUrl,
          cookiesSet,
          cookiesUnset,
        });
      }
    } catch {
      // Ignore response parsing errors
    }
  };

  page.on('response', responseHandler);

  return {
    handler: responseHandler,
    responses,
  };
}

module.exports = setupNetworkMonitor;
