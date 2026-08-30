import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOrStartTabDaemon, runDaemon, sendCommand, stopDaemons } from './daemon.mjs';
import { formatPageList, formatPagesJson, getPages, waitForOpenedTarget } from './pages.mjs';
import { CDP } from './protocol.mjs';
import { PAGES_CACHE, getDisplayPrefixLength, getWsUrl, resolvePrefix } from './runtime.mjs';

const USAGE_HEADER = `cdp - lightweight Chrome DevTools Protocol CLI (no Puppeteer)

Usage: cdp <command> [args]

`;

const COMMAND_USAGE = `  list                              List open pages (shows unique target prefixes)
  tabsjson                          List open pages as compact JSON
  snap  <target> [line] [length]    Bounded accessibility snapshot with element ids
  find  <target> <text> [line] [length]  Search a bounded snapshot
  eval  <target> <expr>             Evaluate JS expression
  shot  <target> [file]             Screenshot (default: screenshot-<target>.png in runtime dir); prints coordinate mapping
  shotel <target> <selector> [file]  Screenshot one element/div by CSS selector, with hardcoded 10px padding
  shotref <target> <id> [file]      Screenshot one element from the latest snapshot
  html  <target> [selector]         Get HTML (full page or CSS selector)
  htmlref <target> <id>             Get HTML for an element from the latest snapshot
  nav   <target> <url>              Navigate to URL and wait for load completion
  net   <target>                    Network performance entries
  click   <target> <selector>       Click one visible element by unique CSS selector
  clickref <target> <id>            Click an element from the latest snapshot
  clickxy <target> <x> <y>          Click at CSS pixel coordinates (see coordinate note below)
  type    <target> <text>           Type at verified editable focus via Input.insertText
                                    Works in cross-origin iframes unlike eval-based approaches
  typeref <target> <id> <text>      Focus a snapshot element and type into it
  loadall <target> <selector> [ms]  Repeatedly click a "load more" button until it disappears
                                    Optional interval in ms between clicks (default 1500)
  evalraw <target> <method> [json]  Send a raw CDP command; returns JSON result
                                    e.g. evalraw <t> "DOM.getDocument" '{}'
  open  [url]                       Open a new tab (default: about:blank)
                                    Chrome may show an "Allow debugging?" prompt on first access
  stop  [target]                    Stop daemon(s)
`;

const USAGE_FOOTER = `
<target> is a unique targetId prefix from "cdp list". If a prefix is ambiguous,
use more characters.

COORDINATE SYSTEM
  shot captures the viewport at the device's native resolution.
  The screenshot image size = CSS pixels × DPR (device pixel ratio).
  For CDP Input events (clickxy, etc.) you need CSS pixels, not image pixels.

    CSS pixels = screenshot image pixels / DPR

  shot prints the DPR and an example conversion for the current page.
  Typical Retina (DPR=2): CSS px ≈ screenshot px × 0.5
  If your viewer rescales the image further, account for that scaling too.

EVAL SAFETY NOTE
  Avoid index-based DOM selection (querySelectorAll(...)[i]) across multiple
  eval calls when the list can change between calls (e.g. after clicking
  "Ignore" buttons on a feed — indices shift). Prefer stable selectors or
  collect all data in a single eval.

DAEMON IPC (for advanced use / scripting)
  Each tab runs a persistent daemon at Unix socket in the runtime dir (see below).
  Protocol: newline-delimited JSON (one JSON object per line, UTF-8).
    Request:  {"id":<number>, "cmd":"<command>", "args":["arg1","arg2",...]}
    Response: {"id":<number>, "ok":true,  "result":"<string>"}
           or {"id":<number>, "ok":false, "error":"<message>"}
  Commands mirror the CLI. Use evalraw to send arbitrary CDP methods.
  The socket disappears after 20 min of inactivity or when the tab closes.
`;

export function cdpUsage({ commands = [] } = {}) {
  const extraCommands = commands
    .map(({ syntax, description }) => `  ${syntax.padEnd(32)}  ${description}\n`)
    .join('');
  return `${USAGE_HEADER}${extraCommands}${COMMAND_USAGE}${USAGE_FOOTER}`;
}

export function isMainModule(moduleUrl) {
  return Boolean(process.argv[1]) &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
}

const NEEDS_TARGET = new Set([
  'snap','snapshot','eval','shot','screenshot','shotel','screenshot-element','elementshot','html','nav','navigate',
  'shotref','htmlref','find','net','network','click','clickref','clickxy','type','typeref','loadall','evalraw',
]);

async function runCli({ discoveryRecovery, startBrowser, usage } = {}) {
  const [cmd, ...args] = process.argv.slice(2);

  // Daemon mode (internal)
  if (cmd === '_daemon') { await runDaemon(args[0], discoveryRecovery); return; }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(usage); process.exit(0);
  }

  if ((cmd === 'start' || cmd === 'launch') && startBrowser) {
    console.log(await startBrowser());
    return;
  }


  if (cmd === 'list' || cmd === 'ls' || cmd === 'tabsjson') {
    const cdp = new CDP();
    await cdp.connect(await getWsUrl(discoveryRecovery));
    const pages = await getPages(cdp);
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(cmd === 'tabsjson' ? formatPagesJson(pages) : formatPageList(pages));
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Open new tab
  if (cmd === 'open') {
    const url = args[0] || 'about:blank';
    const cdp = new CDP();
    await cdp.connect(await getWsUrl(discoveryRecovery));
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const openedTarget = await waitForOpenedTarget(cdp, targetId, url);
    // Refresh cache; new tab may not appear in getTargets immediately, so add it manually.
    const pages = await getPages(cdp);
    if (!pages.some(p => p.targetId === targetId)) {
      pages.push(openedTarget);
    }
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    const prefixLen = getDisplayPrefixLength(pages.map(page => page.targetId));
    console.log(`Opened new tab: ${targetId.slice(0, prefixLen)}  ${url}`);
    console.log('Note: Chrome may request "Allow debugging?" approval on first access.');
    return;
  }

  // Stop
  if (cmd === 'stop') {
    await stopDaemons(args[0]);
    return;
  }

  // Page commands — need target prefix
  if (!NEEDS_TARGET.has(cmd)) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(usage);
    process.exit(1);
  }

  const targetPrefix = args[0];
  if (!targetPrefix) {
    console.error('Error: target ID required. Run "cdp list" first.');
    process.exit(1);
  }

  // Resolve prefix → full targetId from pages cache
  if (!existsSync(PAGES_CACHE)) {
    console.error('No page list cached. Run "cdp list" first.');
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targetId = resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target', 'Run "cdp list".');
  const targetRef = targetId.slice(0, getDisplayPrefixLength(pages.map(page => page.targetId)));

  const conn = await getOrStartTabDaemon(targetId);

  const cmdArgs = args.slice(1);

  if (cmd === 'eval') {
    const expr = cmdArgs.join(' ');
    if (!expr) { console.error('Error: expression required'); process.exit(1); }
    cmdArgs[0] = expr;
  } else if (cmd === 'type') {
    // Join all remaining args as text (allows spaces)
    const text = cmdArgs.join(' ');
    if (!text) { console.error('Error: text required'); process.exit(1); }
    cmdArgs[0] = text;
  } else if (cmd === 'evalraw') {
    // args: [method, ...jsonParts] — join json parts in case of spaces
    if (!cmdArgs[0]) { console.error('Error: CDP method required'); process.exit(1); }
    if (cmdArgs.length > 2) cmdArgs[1] = cmdArgs.slice(1).join(' ');
  }

  if ((cmd === 'nav' || cmd === 'navigate') && !cmdArgs[0]) {
    console.error('Error: URL required');
    process.exit(1);
  }

  const response = await sendCommand(conn, { cmd, args: cmdArgs, targetRef });

  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error('Error:', response.error);
    process.exitCode = 1;
  }
}

export { runCli };
