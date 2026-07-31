#!/usr/bin/env node
// cdp - lightweight Chrome DevTools Protocol CLI
// Uses raw CDP over WebSocket, no Puppeteer dependency.
// Requires Node 22+ (built-in WebSocket).
//
// Per-tab persistent daemon: page commands go through a daemon that holds
// the CDP session open. Chrome may show an "Allow debugging" modal for a
// newly attached tab. Daemons auto-exit after 20min idle.

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import net from 'net';

const TIMEOUT = 15000;
const NAVIGATION_TIMEOUT = 30000;
const IDLE_TIMEOUT = 20 * 60 * 1000;
const DAEMON_CONNECT_RETRIES = 20;
const DAEMON_CONNECT_DELAY = 300;
const BROWSER_START_TIMEOUT = 10000;
const BROWSER_UNIT = 'chrome-cdp-browser.service';
const MIN_TARGET_PREFIX_LEN = 8;
const IS_WINDOWS = process.platform === 'win32';
if (!IS_WINDOWS) process.umask(0o077);
const RUNTIME_DIR = IS_WINDOWS
  ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local'), 'cdp')
  : process.env.XDG_RUNTIME_DIR
    ? resolve(process.env.XDG_RUNTIME_DIR, 'cdp')
    : resolve(homedir(), '.cache', 'cdp');
try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }); } catch {}
const PAGES_CACHE = resolve(RUNTIME_DIR, 'pages.json');

function sockPath(targetId) {
  return IS_WINDOWS
    ? `\\\\.\\pipe\\cdp-${targetId}`
    : resolve(RUNTIME_DIR, `cdp-${targetId}.sock`);
}

async function getJson(url, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

async function probeDebugPort(port, host = process.env.CDP_HOST || '127.0.0.1') {
  const version = await getJson(`http://${host}:${port}/json/version`);
  if (!version.webSocketDebuggerUrl) throw new Error(`No webSocketDebuggerUrl from ${host}:${port}`);
  return version.webSocketDebuggerUrl;
}

async function getWsUrl() {
  const home = homedir();
  // macOS: ~/Library/Application Support/<name>/DevToolsActivePort
  const macBrowsers = [
    'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome for Testing',
    'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge',
  ];
  // Linux: ~/.config/<name>/DevToolsActivePort
  const linuxBrowsers = [
    'google-chrome', 'google-chrome-beta', 'chromium',
    'vivaldi', 'vivaldi-snapshot',
    'BraveSoftware/Brave-Browser', 'microsoft-edge',
  ];
  // Linux Flatpak: ~/.var/app/<app-id>/config/<name>/DevToolsActivePort
  const flatpakBrowsers = [
    ['org.chromium.Chromium', 'chromium'],
    ['com.google.Chrome', 'google-chrome'],
    ['com.brave.Browser', 'BraveSoftware/Brave-Browser'],
    ['com.microsoft.Edge', 'microsoft-edge'],
    ['com.vivaldi.Vivaldi', 'vivaldi'],
  ];
  const candidates = [
    process.env.CDP_PORT_FILE,
    ...macBrowsers.flatMap(b => [
      resolve(home, 'Library/Application Support', b, 'DevToolsActivePort'),
      resolve(home, 'Library/Application Support', b, 'Default/DevToolsActivePort'),
    ]),
    ...linuxBrowsers.flatMap(b => [
      resolve(home, '.config', b, 'DevToolsActivePort'),
      resolve(home, '.config', b, 'Default/DevToolsActivePort'),
    ]),
    ...flatpakBrowsers.flatMap(([appId, name]) => [
      resolve(home, '.var/app', appId, 'config', name, 'DevToolsActivePort'),
      resolve(home, '.var/app', appId, 'config', name, 'Default/DevToolsActivePort'),
    ]),
    // Windows: %LOCALAPPDATA%/<name>/User Data/DevToolsActivePort
    ...(IS_WINDOWS ? ['Google/Chrome', 'BraveSoftware/Brave-Browser', 'Microsoft/Edge'].flatMap(b => {
      const base = process.env.LOCALAPPDATA || resolve(home, 'AppData/Local');
      return [
        resolve(base, b, 'User Data/DevToolsActivePort'),
        resolve(base, b, 'User Data/Default/DevToolsActivePort'),
      ];
    }) : []),
  ].filter(Boolean);
  const host = process.env.CDP_HOST || '127.0.0.1';

  // Prefer a fixed debugging port for deterministic one-shot access.
  // This gives agents deterministic one-shot access to the logged-in browser.
  const ports = [process.env.CDP_PORT || '9222'];
  const errors = [];
  for (const port of ports) {
    try { return await probeDebugPort(port, host); }
    catch (err) { errors.push(`${host}:${port} ${err.message}`); }
  }

  // Fallback for browsers that expose a dynamic debugging port through
  // DevToolsActivePort instead of the fixed 9222 endpoint.
  const portFile = candidates.find(p => existsSync(p));
  if (portFile) {
    const lines = readFileSync(portFile, 'utf8').trim().split('\n');
    if (lines.length < 2 || !lines[0] || !lines[1]) throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
    return `ws://${host}:${lines[0]}${lines[1]}`;
  }

  throw new Error(`CDP HTTP discovery failed and no DevToolsActivePort found. Run "cdp start", enable remote debugging, or set CDP_PORT/CDP_PORT_FILE. Tried: ${errors.join('; ')}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function configuredDebugEndpoint() {
  return {
    port: process.env.CDP_PORT || '9222',
    host: process.env.CDP_HOST || '127.0.0.1',
  };
}

async function waitForDebugEndpoint(endpoint = configuredDebugEndpoint(), timeout = BROWSER_START_TIMEOUT) {
  const { port, host } = endpoint;
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await probeDebugPort(port, host);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Browser did not expose CDP at ${host}:${port} within ${timeout}ms${lastError ? ` (${lastError.message})` : ''}`);
}

async function unitExists(systemctl) {
  const result = await runProcess(systemctl, [
    '--user', 'show', BROWSER_UNIT, '--property=LoadState', '--value',
  ]);
  return result.code === 0 && result.stdout !== 'not-found';
}

async function waitForBrowserOrUnitRemoval(systemctl, endpoint, timeout = BROWSER_START_TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await probeDebugPort(endpoint.port, endpoint.host);
      return 'browser';
    } catch {}
    if (!await unitExists(systemctl)) return 'removed';
    await sleep(100);
  }
  return 'timeout';
}

async function startBrowser() {
  const endpoint = configuredDebugEndpoint();
  const { port, host } = endpoint;
  try {
    await probeDebugPort(port, host);
    return `Browser already running with CDP at ${host}:${port}`;
  } catch {}

  if (process.platform !== 'linux') {
    throw new Error('Automatic browser launch currently requires a Linux systemd user session. Start the authenticated browser normally, then run "cdp list".');
  }

  const systemctl = process.env.CDP_SYSTEMCTL || '/usr/bin/systemctl';
  const systemdRun = process.env.CDP_SYSTEMD_RUN || '/usr/bin/systemd-run';
  const browser = process.env.CDP_BROWSER || '/usr/bin/chromium';
  let lastLaunchError = '';

  // A fixed transient unit gives the browser a clean lifetime, but concurrent
  // starts and immediate browser restart cycles can briefly leave that unit busy.
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await waitForBrowserOrUnitRemoval(systemctl, endpoint);
    if (state === 'browser') {
      return `Browser already running with CDP at ${host}:${port}`;
    }
    if (state === 'timeout') {
      throw new Error(`Browser unit ${BROWSER_UNIT} remained loaded without exposing CDP at ${host}:${port}`);
    }

    await runProcess(systemctl, ['--user', 'reset-failed', BROWSER_UNIT]);
    const browserArgs = [
      `--remote-debugging-address=${host}`,
      `--remote-debugging-port=${port}`,
    ];
    if (process.env.CDP_PROFILE_DIRECTORY) {
      browserArgs.push(`--profile-directory=${process.env.CDP_PROFILE_DIRECTORY}`);
    }
    browserArgs.push('about:blank');

    const launched = await runProcess(systemdRun, [
      '--user',
      '--unit=chrome-cdp-browser',
      '--collect',
      '--property=Type=exec',
      '--property=Restart=no',
      browser,
      ...browserArgs,
    ]);
    if (launched.code === 0) {
      await waitForDebugEndpoint(endpoint);
      return `Started authenticated browser with CDP at ${host}:${port}`;
    }
    lastLaunchError = launched.stderr || launched.stdout || `exit ${launched.code}`;
  }

  throw new Error(`Could not launch the browser through the graphical user session: ${lastLaunchError}`);
}


function resolvePrefix(prefix, candidates, noun = 'target', missingHint = '') {
  const upper = prefix.toUpperCase();
  const matches = candidates.filter(candidate => candidate.toUpperCase().startsWith(upper));
  if (matches.length === 0) {
    const hint = missingHint ? ` ${missingHint}` : '';
    throw new Error(`No ${noun} matching prefix "${prefix}".${hint}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous prefix "${prefix}" — matches ${matches.length} ${noun}s. Use more characters.`);
  }
  return matches[0];
}

function getDisplayPrefixLength(targetIds) {
  if (targetIds.length === 0) return MIN_TARGET_PREFIX_LEN;
  const maxLen = Math.max(...targetIds.map(id => id.length));
  for (let len = MIN_TARGET_PREFIX_LEN; len <= maxLen; len++) {
    const prefixes = new Set(targetIds.map(id => id.slice(0, len).toUpperCase()));
    if (prefixes.size === targetIds.length) return len;
  }
  return maxLen;
}

// ---------------------------------------------------------------------------
// CDP WebSocket client
// ---------------------------------------------------------------------------

class CDP {
  #ws; #id = 0; #pending = new Map(); #eventHandlers = new Map(); #closeHandlers = [];

  async connect(wsUrl) {
    return new Promise((res, rej) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => res();
      this.#ws.onerror = (e) => rej(new Error('WebSocket error: ' + (e.message || e.type)));
      this.#ws.onclose = () => this.#closeHandlers.forEach(h => h());
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve, reject, timer } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method && this.#eventHandlers.has(msg.method)) {
          for (const handler of [...this.#eventHandlers.get(msg.method)]) {
            handler(msg.params || {}, msg);
          }
        }
      };
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, TIMEOUT);
      this.#pending.set(id, { resolve, reject, timer });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      try {
        this.#ws.send(JSON.stringify(msg));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  onEvent(method, handler) {
    if (!this.#eventHandlers.has(method)) this.#eventHandlers.set(method, new Set());
    const handlers = this.#eventHandlers.get(method);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#eventHandlers.delete(method);
    };
  }

  waitForEvent(method, timeout = TIMEOUT) {
    let settled = false;
    let off;
    let timer;
    const promise = new Promise((resolve, reject) => {
      off = this.onEvent(method, (params) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(params);
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error(`Timeout waiting for event: ${method}`));
      }, timeout);
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off?.();
      },
    };
  }

  onClose(handler) { this.#closeHandlers.push(handler); }
  close() { this.#ws.close(); }
}

// ---------------------------------------------------------------------------
// Command implementations — return strings, take (cdp, sessionId)
// ---------------------------------------------------------------------------

async function getPages(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://'));
}

async function waitForOpenedTarget(cdp, targetId, requestedUrl, timeout = 5000) {
  if (requestedUrl === 'about:blank') return { targetId, title: requestedUrl, url: requestedUrl };
  const deadline = Date.now() + timeout;
  let targetInfo = { targetId, title: requestedUrl, url: requestedUrl };
  while (Date.now() < deadline) {
    ({ targetInfo } = await cdp.send('Target.getTargetInfo', { targetId }));
    if (targetInfo.url && targetInfo.url !== 'about:blank') return targetInfo;
    await sleep(100);
  }
  throw new Error(`New tab did not begin navigating to ${requestedUrl}`);
}

function formatPageList(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return pages.map(p => {
    const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
    const title = p.title.substring(0, 54).padEnd(54);
    return `${id}  ${title}  ${p.url}`;
  }).join('\n');
}

function formatPagesJson(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return JSON.stringify(pages.map(p => ({
    ref_id: p.targetId.slice(0, prefixLen),
    title: p.title,
    url: p.url,
  })));
}

function shouldShowAxNode(node, compact = false) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  if (compact && role === 'InlineTextBox') return false;
  return role !== 'none' && role !== 'generic' && !(name === '' && (value === '' || value == null));
}

function formatAxNode(node, depth) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  const indent = '  '.repeat(Math.min(depth, 10));
  let line = `${indent}[${role}]`;
  if (name !== '') line += ` ${name}`;
  if (!(value === '' || value == null)) line += ` = ${JSON.stringify(value)}`;
  return line;
}

function orderedAxChildren(node, nodesById, childrenByParent) {
  const children = [];
  const seen = new Set();
  for (const childId of node.childIds || []) {
    const child = nodesById.get(childId);
    if (child && !seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  for (const child of childrenByParent.get(node.nodeId) || []) {
    if (!seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  return children;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option',
  'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox',
  'treeitem',
]);
const SNAPSHOT_LIMITS = { short: 60, medium: 140, long: 300 };

function normalizeSnapshotText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitSnapshotText(value, max = 700) {
  const text = normalizeSnapshotText(value);
  if (!text) return [];
  const parts = [];
  for (let start = 0; start < text.length; start += max) parts.push(text.slice(start, start + max));
  return parts;
}

async function snapshotData(cdp, sid, elementRefs, options = {}) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, sid);
  const nodesById = new Map(nodes.map(node => [node.nodeId, node]));
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node);
  }

  elementRefs.clear();
  const lines = [];
  const elements = [];
  const visited = new Set();
  let nextElementId = 1;
  function addLine(text, element, kind = 'text') {
    for (const part of splitSnapshotText(text)) {
      const line = { line: lines.length + 1, text: part, kind };
      if (element) line.element_id = element.id;
      lines.push(line);
    }
  }
  function addStaticText(text) {
    const normalized = normalizeSnapshotText(text);
    if (!normalized) return;
    const previous = lines.at(-1);
    if (previous?.kind === 'text' && previous.text.length + normalized.length + 1 <= 700) {
      previous.text += ` ${normalized}`;
      return;
    }
    addLine(normalized);
  }
  function visit(node, depth, parentName = '') {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    const role = node.role?.value || '';
    const name = normalizeSnapshotText(node.name?.value ?? '');
    const value = node.value?.value;
    let renderedName = parentName;
    if (!node.ignored && shouldShowAxNode(node, true)) {
      const interactive = INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId;
      if (interactive) {
        const element = {
          id: nextElementId++,
          role,
          ...(name ? { name } : {}),
          ...(value === '' || value == null ? {} : { value }),
        };
        elementRefs.set(element.id, node.backendDOMNodeId);
        elements.push(element);
        addLine(`[${element.id}] ${role}${name ? ` ${name}` : ''}${value === '' || value == null ? '' : ` = ${JSON.stringify(value)}`}`, element, 'interactive');
        renderedName = name;
      } else if (role === 'StaticText') {
        if (name && name !== parentName) addStaticText(name);
      } else if (role === 'heading' || role === 'image') {
        if (name) addLine(`${role}: ${name}`, undefined, role);
        renderedName = name || parentName;
      }
    }
    for (const child of orderedAxChildren(node, nodesById, childrenByParent)) {
      visit(child, depth + 1, renderedName);
    }
  }

  const roots = nodes.filter(node => !node.parentId || !nodesById.has(node.parentId));
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);

  const metadata = JSON.parse(await evalStr(cdp, sid, '({title: document.title, url: location.href})'));
  const pattern = options.pattern?.toLowerCase();
  const matching = pattern
    ? lines.filter(line => line.text.toLowerCase().includes(pattern))
    : lines;
  const start = Math.max(0, (options.lineno || 1) - 1);
  const limit = SNAPSHOT_LIMITS[options.responseLength] || SNAPSHOT_LIMITS.medium;
  const content = matching.slice(start, start + limit).map(({ kind: _kind, ...line }) => line);
  const visibleIds = new Set(content.map(line => line.element_id).filter(Boolean));
  const visibleElements = elements.filter(element => visibleIds.has(element.id));
  const hasMore = start + content.length < matching.length;
  return {
    ref_id: options.refId,
    title: metadata.title,
    url: metadata.url,
    lineno: start + 1,
    content,
    elements: visibleElements,
    ...(pattern ? { pattern: options.pattern } : {}),
    ...(hasMore ? { next_lineno: start + content.length + 1 } : {}),
  };
}

async function snapshotStr(cdp, sid, elementRefs, refId, lineno, responseLength) {
  return JSON.stringify(await snapshotData(cdp, sid, elementRefs, {
    refId,
    lineno: Number.parseInt(lineno || '1', 10),
    responseLength,
  }));
}

async function findStr(cdp, sid, elementRefs, refId, pattern, lineno, responseLength) {
  if (!pattern) throw new Error('pattern required');
  return JSON.stringify(await snapshotData(cdp, sid, elementRefs, {
    refId,
    pattern,
    lineno: Number.parseInt(lineno || '1', 10),
    responseLength,
  }));
}

async function evalStr(cdp, sid, expression) {
  await cdp.send('Runtime.enable', {}, sid);
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sid);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
}

async function getDpr(cdp, sid) {
  // Get device scale factor so we can report coordinate mapping
  let dpr = 1;
  try {
    const metrics = await cdp.send('Page.getLayoutMetrics', {}, sid);
    dpr = metrics.visualViewport?.clientWidth
      ? metrics.cssVisualViewport?.clientWidth
        ? Math.round((metrics.visualViewport.clientWidth / metrics.cssVisualViewport.clientWidth) * 100) / 100
        : 1
      : 1;
    // Simpler: deviceScaleFactor is on the root Page metrics
    const { deviceScaleFactor } = await cdp.send('Emulation.getDeviceMetricsOverride', {}, sid).catch(() => ({}));
    if (deviceScaleFactor) dpr = deviceScaleFactor;
  } catch {}
  // Fallback: try to get DPR from JS
  if (dpr === 1) {
    try {
      const raw = await evalStr(cdp, sid, 'window.devicePixelRatio');
      const parsed = parseFloat(raw);
      if (parsed > 0) dpr = parsed;
    } catch {}
  }
  return dpr;
}

function screenshotReport(out, dpr, extraLines = []) {
  const lines = [out];
  lines.push(...extraLines);
  lines.push(`Screenshot saved. Device pixel ratio (DPR): ${dpr}`);
  lines.push(`Coordinate mapping:`);
  lines.push(`  Screenshot pixels → CSS pixels (for CDP Input events): divide by ${dpr}`);
  lines.push(`  e.g. screenshot point (${Math.round(100 * dpr)}, ${Math.round(200 * dpr)}) → CSS (100, 200) → use clickxy <target> 100 200`);
  if (dpr !== 1) {
    lines.push(`  On this ${dpr}x display: CSS px = screenshot px / ${dpr} ≈ screenshot px × ${Math.round(100/dpr)/100}`);
  }
  return lines.join('\n');
}

async function shotStr(cdp, sid, filePath, targetId) {
  const dpr = await getDpr(cdp, sid);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
  const out = filePath || resolve(RUNTIME_DIR, `screenshot-${(targetId || 'unknown').slice(0, 8)}.png`);
  writeFileSync(out, Buffer.from(data, 'base64'));
  return screenshotReport(out, dpr);
}

async function shotElementStr(cdp, sid, selector, filePath, targetId) {
  if (!selector) throw new Error('CSS selector required');
  const padding = 10;
  const expr = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, r.left - ${padding});
      const y = Math.max(0, r.top - ${padding});
      const right = Math.min(vw, r.right + ${padding});
      const bottom = Math.min(vh, r.bottom + ${padding});
      return {
        ok: true,
        tag: el.tagName,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        clip: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), scale: 1 }
      };
    })()
  `;
  const result = JSON.parse(await evalStr(cdp, sid, expr));
  if (!result.ok) throw new Error(result.error);
  const dpr = await getDpr(cdp, sid);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: result.clip }, sid);
  const out = filePath || resolve(RUNTIME_DIR, `screenshot-${(targetId || 'unknown').slice(0, 8)}-element.png`);
  writeFileSync(out, Buffer.from(data, 'base64'));
  return screenshotReport(out, dpr, [
    `Element screenshot saved for selector: ${selector}`,
    `Clip: ${Math.round(result.width)}×${Math.round(result.height)} CSS px, including ${padding}px padding`
  ]);
}

function requireElementRef(elementRefs, id) {
  const parsed = Number.parseInt(id, 10);
  const backendNodeId = elementRefs.get(parsed);
  if (!backendNodeId) throw new Error(`Unknown element id ${id}; run open again and use a current element id`);
  return { id: parsed, backendNodeId };
}

async function resolveBackendObject(cdp, sid, backendNodeId) {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId }, sid);
  if (!object?.objectId) throw new Error('Element is no longer available; run open again');
  return object.objectId;
}

async function scrollBackendIntoView(cdp, sid, backendNodeId) {
  const objectId = await resolveBackendObject(cdp, sid, backendNodeId);
  await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { this.scrollIntoView({block: "center", inline: "center"}); }',
  }, sid);
  await sleep(50);
}

async function backendCenter(cdp, sid, backendNodeId) {
  await scrollBackendIntoView(cdp, sid, backendNodeId);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId }, sid);
  const quad = model?.content || model?.border;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error('Element has no clickable box');
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}

async function shotRefStr(cdp, sid, elementRefs, id, filePath, targetId) {
  const ref = requireElementRef(elementRefs, id);
  await scrollBackendIntoView(cdp, sid, ref.backendNodeId);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: ref.backendNodeId }, sid);
  const quad = model?.border;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error('Element has no screenshot box');
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.max(0, Math.min(...xs) - 10);
  const y = Math.max(0, Math.min(...ys) - 10);
  const width = Math.max(1, Math.max(...xs) - Math.min(...xs) + 20);
  const height = Math.max(1, Math.max(...ys) - Math.min(...ys) + 20);
  const dpr = await getDpr(cdp, sid);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x, y, width, height, scale: 1 },
  }, sid);
  const out = filePath || resolve(RUNTIME_DIR, `screenshot-${(targetId || 'unknown').slice(0, 8)}-element.png`);
  writeFileSync(out, Buffer.from(data, 'base64'));
  return screenshotReport(out, dpr, [`Element screenshot saved for id: ${ref.id}`]);
}

async function htmlStr(cdp, sid, selector) {
  if (!selector) return evalStr(cdp, sid, 'document.documentElement.outerHTML');
  const result = JSON.parse(await evalStr(cdp, sid, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element ? { ok: true, html: element.outerHTML } : { ok: false };
    })()
  `));
  if (!result.ok) throw new Error(`Element not found: ${selector}`);
  return result.html;
}

async function htmlRefStr(cdp, sid, elementRefs, id) {
  const ref = requireElementRef(elementRefs, id);
  const objectId = await resolveBackendObject(cdp, sid, ref.backendNodeId);
  const result = await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this.outerHTML; }',
    returnByValue: true,
  }, sid);
  return result.result?.value || '';
}

async function waitForDocumentReady(cdp, sid, timeoutMs = NAVIGATION_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;
  let lastState = '';
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = await evalStr(cdp, sid, 'document.readyState');
      lastState = state;
      if (state === 'complete') return;
    } catch (e) {
      lastError = e;
    }
    await sleep(200);
  }

  if (lastState) {
    throw new Error(`Timed out waiting for navigation to finish (last readyState: ${lastState})`);
  }
  if (lastError) {
    throw new Error(`Timed out waiting for navigation to finish (${lastError.message})`);
  }
  throw new Error('Timed out waiting for navigation to finish');
}

async function navStr(cdp, sid, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new Error(`Only http/https URLs allowed, got: ${url}`);
  } catch (e) {
    if (e.message.startsWith('Only')) throw e;
    throw new Error(`Invalid URL: ${url}`);
  }
  await cdp.send('Page.enable', {}, sid);
  const loadEvent = cdp.waitForEvent('Page.loadEventFired', NAVIGATION_TIMEOUT);
  const result = await cdp.send('Page.navigate', { url }, sid);
  if (result.errorText) {
    loadEvent.cancel();
    throw new Error(result.errorText);
  }
  if (result.loaderId) {
    await loadEvent.promise;
  } else {
    loadEvent.cancel();
  }
  await waitForDocumentReady(cdp, sid, 5000);
  return `Navigated to ${url}`;
}

async function netStr(cdp, sid) {
  const raw = await evalStr(cdp, sid, `JSON.stringify(performance.getEntriesByType('resource').map(e => ({
    name: e.name.substring(0, 120), type: e.initiatorType,
    duration: Math.round(e.duration), size: e.transferSize
  })))`);
  return JSON.parse(raw).map(e =>
    `${String(e.duration).padStart(5)}ms  ${String(e.size || '?').padStart(8)}B  ${e.type.padEnd(8)}  ${e.name}`
  ).join('\n');
}

// Click element by CSS selector
async function clickStr(cdp, sid, selector) {
  if (!selector) throw new Error('CSS selector required');
  const expr = `
    (function() {
      const selector = ${JSON.stringify(selector)};
      const matches = document.querySelectorAll(selector);
      if (matches.length === 0) return { ok: false, error: 'Element not found: ' + selector };
      if (matches.length > 1) return { ok: false, error: 'Selector matched ' + matches.length + ' elements: ' + selector };
      const el = matches[0];
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
      const hidden = rect.width <= 0 || rect.height <= 0 || style.display === 'none' ||
        style.visibility === 'hidden' || style.visibility === 'collapse' ||
        style.pointerEvents === 'none' || Number(style.opacity) === 0 ||
        el.closest('[inert]') !== null;
      if (hidden) return { ok: false, error: 'Element is not visible or interactable: ' + selector };
      if (disabled) return { ok: false, error: 'Element is disabled: ' + selector };

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return {
        ok: true,
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 80),
        x,
        y
      };
    })()
  `;
  const result = await evalStr(cdp, sid, expr);
  const r = JSON.parse(result);
  if (!r.ok) throw new Error(r.error);
  await clickXyStr(cdp, sid, r.x, r.y);
  return `Clicked <${r.tag}> "${r.text}"`;
}

async function clickRefStr(cdp, sid, elementRefs, id) {
  const ref = requireElementRef(elementRefs, id);
  const point = await backendCenter(cdp, sid, ref.backendNodeId);
  await clickXyStr(cdp, sid, point.x, point.y);
  return `Clicked element ${ref.id}`;
}

// Click at CSS pixel coordinates using Input.dispatchMouseEvent
async function clickXyStr(cdp, sid, x, y) {
  const cx = parseFloat(x);
  const cy = parseFloat(y);
  if (isNaN(cx) || isNaN(cy)) throw new Error('x and y must be numbers (CSS pixels)');
  const base = { x: cx, y: cy, button: 'left', clickCount: 1, modifiers: 0 };
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' }, sid);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, sid);
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, sid);
  return `Clicked at CSS (${cx}, ${cy})`;
}

// Type text using Input.insertText (works in cross-origin iframes, unlike eval)
async function typeStr(cdp, sid, text) {
  if (text == null || text === '') throw new Error('text required');
  const focusState = JSON.parse(await evalStr(cdp, sid, `
    (() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) {
        return { ok: false, error: 'No editable element is focused' };
      }
      const tag = el.tagName;
      const inputTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
      const input = tag === 'INPUT' && inputTypes.has((el.type || 'text').toLowerCase());
      const textarea = tag === 'TEXTAREA';
      const contentEditable = el.isContentEditable;
      const iframe = tag === 'IFRAME';
      if (!input && !textarea && !contentEditable && !iframe) {
        return { ok: false, error: 'Focused <' + tag + '> is not editable' };
      }
      if ((input || textarea) && (el.disabled || el.readOnly)) {
        return { ok: false, error: 'Focused <' + tag + '> is disabled or read-only' };
      }
      return {
        ok: true,
        tag,
        iframe,
        inspectable: !iframe,
        before: input || textarea ? el.value : contentEditable ? el.textContent : null
      };
    })()
  `));
  if (!focusState.ok) throw new Error(focusState.error);

  await cdp.send('Input.insertText', { text }, sid);
  if (!focusState.inspectable) {
    return `Sent ${text.length} characters to focused <${focusState.tag}>; cross-origin result is not inspectable`;
  }

  const after = JSON.parse(await evalStr(cdp, sid, `
    (() => {
      const el = document.activeElement;
      if (!el) return { focused: false, value: null };
      const tag = el.tagName;
      const value = tag === 'INPUT' || tag === 'TEXTAREA' ? el.value : el.isContentEditable ? el.textContent : null;
      return { focused: true, tag, value };
    })()
  `));
  if (!after.focused || after.tag !== focusState.tag) {
    throw new Error('Focus changed while typing; input result could not be verified');
  }
  if (after.value === focusState.before) {
    throw new Error(`Input.insertText completed but focused <${focusState.tag}> did not change`);
  }
  return `Typed ${text.length} characters into focused <${focusState.tag}>`;
}

async function typeRefStr(cdp, sid, elementRefs, id, text) {
  await clickRefStr(cdp, sid, elementRefs, id);
  return typeStr(cdp, sid, text);
}

// Load-more: repeatedly click a button/selector until it disappears
async function loadAllStr(cdp, sid, selector, intervalMs = 1500) {
  if (!selector) throw new Error('CSS selector required');
  let clicks = 0;
  let disappeared = false;
  const deadline = Date.now() + 5 * 60 * 1000; // 5-minute hard cap
  while (Date.now() < deadline) {
    const exists = await evalStr(cdp, sid,
      `!!document.querySelector(${JSON.stringify(selector)})`
    );
    if (exists !== 'true') {
      disappeared = true;
      break;
    }
    await clickStr(cdp, sid, selector);
    clicks++;
    await sleep(intervalMs);
  }
  return disappeared
    ? `Clicked "${selector}" ${clicks} time(s) until it disappeared`
    : `Clicked "${selector}" ${clicks} time(s); stopped at the five-minute deadline while it was still present`;
}

// Send a raw CDP command and return the result as JSON
async function evalRawStr(cdp, sid, method, paramsJson) {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try { params = JSON.parse(paramsJson); }
    catch { throw new Error(`Invalid JSON params: ${paramsJson}`); }
  }
  const result = await cdp.send(method, params, sid);
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Per-tab daemon
// ---------------------------------------------------------------------------

async function runDaemon(targetId) {
  const sp = sockPath(targetId);

  const cdp = new CDP();
  try {
    await cdp.connect(await getWsUrl());
  } catch (e) {
    process.stderr.write(`Daemon: cannot connect to Chrome: ${e.message}\n`);
    process.exit(1);
  }

  let sessionId;
  try {
    const res = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = res.sessionId;
  } catch (e) {
    process.stderr.write(`Daemon: attach failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  const elementRefs = new Map();

  // Shutdown helpers
  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    cdp.close();
    process.exit(0);
  }

  // Exit if target goes away or Chrome disconnects
  cdp.onEvent('Target.targetDestroyed', (params) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent('Target.detachedFromTarget', (params) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Idle timer
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  // Handle a command
  async function handleCommand({ cmd, args }) {
    resetIdle();
    try {
      let result;
      switch (cmd) {
        case 'list': {
          const pages = await getPages(cdp);
          result = formatPageList(pages);
          break;
        }
        case 'list_raw': {
          const pages = await getPages(cdp);
          result = JSON.stringify(pages);
          break;
        }
        case 'tabsjson': {
          const pages = await getPages(cdp);
          result = formatPagesJson(pages);
          break;
        }
        case 'snap': case 'snapshot': result = await snapshotStr(cdp, sessionId, elementRefs, targetId.slice(0, 8), args[0], args[1]); break;
        case 'find': result = await findStr(cdp, sessionId, elementRefs, targetId.slice(0, 8), args[0], args[1], args[2]); break;
        case 'eval': result = await evalStr(cdp, sessionId, args[0]); break;
        case 'shot': case 'screenshot': result = await shotStr(cdp, sessionId, args[0], targetId); break;
        case 'shotel': case 'screenshot-element': case 'elementshot': result = await shotElementStr(cdp, sessionId, args[0], args[1], targetId); break;
        case 'shotref': result = await shotRefStr(cdp, sessionId, elementRefs, args[0], args[1], targetId); break;
        case 'html': result = await htmlStr(cdp, sessionId, args[0]); break;
        case 'htmlref': result = await htmlRefStr(cdp, sessionId, elementRefs, args[0]); break;
        case 'nav': case 'navigate': result = await navStr(cdp, sessionId, args[0]); break;
        case 'net': case 'network': result = await netStr(cdp, sessionId); break;
        case 'click': result = await clickStr(cdp, sessionId, args[0]); break;
        case 'clickref': result = await clickRefStr(cdp, sessionId, elementRefs, args[0]); break;
        case 'clickxy': result = await clickXyStr(cdp, sessionId, args[0], args[1]); break;
        case 'type': result = await typeStr(cdp, sessionId, args[0]); break;
        case 'typeref': result = await typeRefStr(cdp, sessionId, elementRefs, args[0], args[1]); break;
        case 'loadall': result = await loadAllStr(cdp, sessionId, args[0], args[1] ? parseInt(args[1]) : 1500); break;
        case 'evalraw': result = await evalRawStr(cdp, sessionId, args[0], args[1]); break;
        case 'stop': return { ok: true, result: '', stopAfter: true };
        default: return { ok: false, error: `Unknown command: ${cmd}` };
      }
      return { ok: true, result: result ?? '' };
    } catch (e) {
      const error = e.message.startsWith('Timeout:')
        ? `${e.message}. Chrome may be waiting for "Allow debugging" approval, or the tab may be sleeping.`
        : e.message;
      return { ok: false, error };
    }
  }

  // Unix socket server — NDJSON protocol
  // Wire format: each message is one JSON object followed by \n (newline-delimited JSON).
  // Request:  { "id": <number>, "cmd": "<command>", "args": ["arg1", "arg2", ...] }
  // Response: { "id": <number>, "ok": <boolean>, "result": "<string>" }
  //           or { "id": <number>, "ok": false, "error": "<message>" }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          conn.write(JSON.stringify({ ok: false, error: 'Invalid JSON request', id: null }) + '\n');
          continue;
        }
        handleCommand(req).then((res) => {
          const payload = JSON.stringify({ ...res, id: req.id }) + '\n';
          if (res.stopAfter) conn.end(payload, shutdown);
          else conn.write(payload);
        });
      }
    });
  });

  server.on('error', (e) => {
    process.stderr.write(`Daemon server listen failed: ${e.message}\n`);
    process.exit(1);
  });

  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
  server.listen(sp);
}

// ---------------------------------------------------------------------------
// CLI ↔ daemon communication
// ---------------------------------------------------------------------------

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function getOrStartTabDaemon(targetId) {
  const sp = sockPath(targetId);
  // Try existing daemon
  try { return await connectToSocket(sp); } catch {}

  // Clean stale socket
  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}

  // Spawn daemon
  const child = spawn(process.execPath, [process.argv[1], '_daemon', targetId], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for socket (includes time for user to click Allow)
  for (let i = 0; i < DAEMON_CONNECT_RETRIES; i++) {
    await sleep(DAEMON_CONNECT_DELAY);
    try { return await connectToSocket(sp); } catch {}
  }
  throw new Error('Daemon failed to start — did you click Allow in Chrome?');
}

function sendCommand(conn, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;

    const cleanup = () => {
      conn.off('data', onData);
      conn.off('error', onError);
      conn.off('end', onEnd);
      conn.off('close', onClose);
    };

    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      settled = true;
      cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    conn.on('data', onData);
    conn.on('error', onError);
    conn.on('end', onEnd);
    conn.on('close', onClose);
    req.id = 1;
    conn.write(JSON.stringify(req) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Stop daemons
// ---------------------------------------------------------------------------

async function stopDaemons(targetPrefix) {
  if (!existsSync(PAGES_CACHE)) return;
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targets = targetPrefix
    ? [resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target')]
    : pages.map(p => p.targetId);

  for (const targetId of targets) {
    const sp = sockPath(targetId);
    try {
      const conn = await connectToSocket(sp);
      await sendCommand(conn, { cmd: 'stop' });
    } catch {
      if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `cdp - lightweight Chrome DevTools Protocol CLI (no Puppeteer)

Usage: cdp <command> [args]

  start                             Start the authenticated graphical browser on demand (Linux/systemd)
  list                              List open pages (shows unique target prefixes)
  snap  <target>                    Accessibility tree snapshot
  eval  <target> <expr>             Evaluate JS expression
  shot  <target> [file]             Screenshot (default: screenshot-<target>.png in runtime dir); prints coordinate mapping
  shotel <target> <selector> [file]  Screenshot one element/div by CSS selector, with hardcoded 10px padding
  html  <target> [selector]         Get HTML (full page or CSS selector)
  nav   <target> <url>              Navigate to URL and wait for load completion
  net   <target>                    Network performance entries
  click   <target> <selector>       Click one visible element by unique CSS selector
  clickxy <target> <x> <y>          Click at CSS pixel coordinates (see coordinate note below)
  type    <target> <text>           Type at verified editable focus via Input.insertText
                                    Works in cross-origin iframes unlike eval-based approaches
  loadall <target> <selector> [ms]  Repeatedly click a "load more" button until it disappears
                                    Optional interval in ms between clicks (default 1500)
  evalraw <target> <method> [json]  Send a raw CDP command; returns JSON result
                                    e.g. evalraw <t> "DOM.getDocument" '{}'
  open  [url]                       Open a new tab (default: about:blank)
                                    Chrome may show an "Allow debugging?" prompt on first access
  stop  [target]                    Stop daemon(s)

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
  Commands mirror the CLI: snap, eval, shot, shotel, html, nav, net, click, clickxy,
  type, loadall, evalraw, stop. Use evalraw to send arbitrary CDP methods.
  The socket disappears after 20 min of inactivity or when the tab closes.
`;

const NEEDS_TARGET = new Set([
  'snap','snapshot','eval','shot','screenshot','shotel','screenshot-element','elementshot','html','nav','navigate',
  'shotref','htmlref','find','net','network','click','clickref','clickxy','type','typeref','loadall','evalraw',
]);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  // Daemon mode (internal)
  if (cmd === '_daemon') { await runDaemon(args[0]); return; }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE); process.exit(0);
  }

  if (cmd === 'start' || cmd === 'launch') {
    console.log(await startBrowser());
    return;
  }

  if (cmd === 'list' || cmd === 'ls' || cmd === 'tabsjson') {
    const cdp = new CDP();
    await cdp.connect(await getWsUrl());
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
    await cdp.connect(await getWsUrl());
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
    console.log(USAGE);
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

  const response = await sendCommand(conn, { cmd, args: cmdArgs });

  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error('Error:', response.error);
    process.exitCode = 1;
  }
}

export { clickStr, formatPagesJson, htmlStr, snapshotData };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
