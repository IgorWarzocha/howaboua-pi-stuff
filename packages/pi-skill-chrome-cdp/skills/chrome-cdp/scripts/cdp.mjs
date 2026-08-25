#!/usr/bin/env node
// cdp - lightweight Chrome DevTools Protocol CLI
// Uses raw CDP over WebSocket, no Puppeteer dependency.
// Requires Node 22+ (built-in WebSocket).

import { cdpUsage, isMainModule, runCli } from './cdp-lib/cli.mjs';

export { clickStr, htmlStr } from './cdp-lib/actions.mjs';
export { formatPagesJson } from './cdp-lib/pages.mjs';
export { cdpTimeoutAttempts } from './cdp-lib/protocol.mjs';
export { snapshotData } from './cdp-lib/snapshot.mjs';

if (isMainModule(import.meta.url)) {
  runCli({ usage: cdpUsage() }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
