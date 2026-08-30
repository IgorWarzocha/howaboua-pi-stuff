import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { evalStr } from './evaluate.mjs';
import { NAVIGATION_TIMEOUT, RUNTIME_DIR, sleep } from './runtime.mjs';
import { positiveInteger } from './snapshot.mjs';

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
  const parsed = positiveInteger(id, 'element id');
  const backendNodeId = elementRefs.get(parsed);
  if (!backendNodeId) throw new Error(`Unknown element id ${id}; run open again and use a current element id`);
  return { id: parsed, backendNodeId };
}

async function resolveBackendObject(cdp, sid, backendNodeId) {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId }, sid);
  if (!object?.objectId) throw new Error('Element is no longer available; run open again');
  return object.objectId;
}

async function withBackendObject(cdp, sid, backendNodeId, action) {
  const objectId = await resolveBackendObject(cdp, sid, backendNodeId);
  try {
    return await action(objectId);
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId }, sid).catch(() => {});
  }
}

async function scrollBackendIntoView(cdp, sid, backendNodeId) {
  await withBackendObject(cdp, sid, backendNodeId, (objectId) =>
    cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { this.scrollIntoView({block: "center", inline: "center"}); }',
    }, sid));
  await sleep(50);
}

async function backendCenter(cdp, sid, backendNodeId, scroll = true) {
  if (scroll) await scrollBackendIntoView(cdp, sid, backendNodeId);
  const result = await withBackendObject(cdp, sid, backendNodeId, (objectId) =>
    cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const rect = this.getBoundingClientRect();
        const style = getComputedStyle(this);
        const disabled = this.matches(':disabled') || this.getAttribute('aria-disabled') === 'true';
        const hidden = rect.width <= 0 || rect.height <= 0 || style.display === 'none' ||
          style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.pointerEvents === 'none' || Number(style.opacity) === 0 ||
          this.closest('[inert]') !== null;
        if (hidden) return { ok: false, error: 'Element is not visible or interactable' };
        if (disabled) return { ok: false, error: 'Element is disabled' };
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const root = this.getRootNode();
        const hit = root && typeof root.elementFromPoint === 'function'
          ? root.elementFromPoint(x, y)
          : this.ownerDocument.elementFromPoint(x, y);
        if (!hit || (hit !== this && !this.contains(hit))) {
          const blocker = hit ? '<' + hit.tagName.toLowerCase() + '>' : 'no element';
          return { ok: false, error: 'Element center is covered by ' + blocker };
        }
        return {
          ok: true,
          x,
          y,
          tag: this.tagName,
          text: (this.textContent || '').trim().substring(0, 80)
        };
      }`,
      returnByValue: true,
    }, sid));
  const point = result.result?.value;
  if (!point?.ok) throw new Error(point?.error || 'Element has no clickable box');
  return point;
}

async function selectorBackendNode(cdp, sid, selector) {
  await cdp.send('Runtime.enable', {}, sid);
  const selected = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const selector = ${JSON.stringify(selector)};
      const matches = document.querySelectorAll(selector);
      if (matches.length === 0) throw new Error('Element not found: ' + selector);
      if (matches.length > 1) throw new Error('Selector matched ' + matches.length + ' elements: ' + selector);
      return matches[0];
    })()`,
    returnByValue: false,
    awaitPromise: true,
  }, sid);
  if (selected.exceptionDetails) {
    throw new Error(selected.exceptionDetails.exception?.description || selected.exceptionDetails.text);
  }
  const objectId = selected.result?.objectId;
  if (!objectId) throw new Error(`Element is no longer available: ${selector}`);
  try {
    const { node } = await cdp.send('DOM.describeNode', { objectId }, sid);
    if (!node?.backendNodeId) throw new Error(`Element is no longer available: ${selector}`);
    return node.backendNodeId;
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId }, sid).catch(() => {});
  }
}

async function visibleElementClip(cdp, sid, quad, padding = 10) {
  const metrics = await cdp.send('Page.getLayoutMetrics', {}, sid);
  const viewport = metrics.cssVisualViewport ?? metrics.visualViewport ??
    metrics.cssLayoutViewport ?? metrics.layoutViewport;
  if (!(viewport?.clientWidth > 0) || !(viewport?.clientHeight > 0)) {
    throw new Error('Could not determine a bounded screenshot viewport');
  }
  const pageX = viewport.pageX ?? 0;
  const pageY = viewport.pageY ?? 0;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.max(pageX, Math.min(...xs) - padding);
  const y = Math.max(pageY, Math.min(...ys) - padding);
  const right = Math.min(pageX + viewport.clientWidth, Math.max(...xs) + padding);
  const bottom = Math.min(pageY + viewport.clientHeight, Math.max(...ys) + padding);
  if (right <= x || bottom <= y) throw new Error('Element has no visible screenshot box');
  return { x, y, width: right - x, height: bottom - y, scale: 1 };
}

async function shotRefStr(cdp, sid, elementRefs, id, filePath, targetId) {
  const ref = requireElementRef(elementRefs, id);
  await scrollBackendIntoView(cdp, sid, ref.backendNodeId);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: ref.backendNodeId }, sid);
  const quad = model?.border;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error('Element has no screenshot box');
  const clip = await visibleElementClip(cdp, sid, quad);
  const dpr = await getDpr(cdp, sid);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', clip, captureBeyondViewport: false,
  }, sid);
  const out = filePath || resolve(RUNTIME_DIR, `screenshot-${(targetId || 'unknown').slice(0, 8)}-element.png`);
  writeFileSync(out, Buffer.from(data, 'base64'));
  return screenshotReport(out, dpr, [
    `Element screenshot saved for id: ${ref.id}`,
    `Clip: ${Math.round(clip.width)}×${Math.round(clip.height)} visible CSS px`,
  ]);
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
  const result = await withBackendObject(cdp, sid, ref.backendNodeId, (objectId) =>
    cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { return this.outerHTML; }',
      returnByValue: true,
    }, sid));
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
  const backendNodeId = await selectorBackendNode(cdp, sid, selector);
  const point = await clickBackendNode(cdp, sid, backendNodeId);
  return `Clicked <${point.tag}> "${point.text}"`;
}

async function clickRefStr(cdp, sid, elementRefs, id) {
  const ref = requireElementRef(elementRefs, id);
  await clickBackendNode(cdp, sid, ref.backendNodeId);
  return `Clicked element ${ref.id}`;
}

async function clickBackendNode(cdp, sid, backendNodeId) {
  const initial = await backendCenter(cdp, sid, backendNodeId);
  await dispatchMouse(cdp, sid, 'mouseMoved', initial);
  const point = await backendCenter(cdp, sid, backendNodeId, false);
  await pressAndRelease(cdp, sid, point);
  return point;
}

// Click at CSS pixel coordinates using Input.dispatchMouseEvent
async function clickXyStr(cdp, sid, x, y) {
  const cx = parseFloat(x);
  const cy = parseFloat(y);
  if (isNaN(cx) || isNaN(cy)) throw new Error('x and y must be numbers (CSS pixels)');
  const point = { x: cx, y: cy };
  await dispatchMouse(cdp, sid, 'mouseMoved', point);
  await pressAndRelease(cdp, sid, point);
  return `Clicked at CSS (${cx}, ${cy})`;
}

function dispatchMouse(cdp, sid, type, point) {
  return cdp.send('Input.dispatchMouseEvent', {
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
    modifiers: 0,
    type,
  }, sid);
}

async function pressAndRelease(cdp, sid, point) {
  let pressed = false;
  try {
    await dispatchMouse(cdp, sid, 'mousePressed', point);
    pressed = true;
    await sleep(50);
    await dispatchMouse(cdp, sid, 'mouseReleased', point);
    pressed = false;
  } finally {
    if (pressed) await dispatchMouse(cdp, sid, 'mouseReleased', point).catch(() => {});
  }
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
  if (text == null || text === '') throw new Error('text required');
  const ref = requireElementRef(elementRefs, id);
  await backendCenter(cdp, sid, ref.backendNodeId);
  return withBackendObject(cdp, sid, ref.backendNodeId, async (objectId) => {
    const focusState = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const tag = this.tagName;
        const inputTypes = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
        const input = tag === 'INPUT' && inputTypes.has((this.type || 'text').toLowerCase());
        const textarea = tag === 'TEXTAREA';
        const contentEditable = this.isContentEditable;
        if (!input && !textarea && !contentEditable)
          return { ok: false, error: '<' + tag + '> is not editable' };
        if ((input || textarea) && (this.disabled || this.readOnly))
          return { ok: false, error: '<' + tag + '> is disabled or read-only' };
        this.focus({ preventScroll: true });
        const root = this.getRootNode();
        if (root.activeElement !== this && this.ownerDocument.activeElement !== this)
          return { ok: false, error: 'Could not focus editable <' + tag + '>' };
        const before = input || textarea ? this.value : this.textContent;
        return { ok: true, tag, before };
      }`,
      returnByValue: true,
    }, sid)).result?.value;
    if (!focusState?.ok) throw new Error(focusState?.error || 'Element is not editable');
    const activeBefore = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        const root = this.getRootNode();
        return root.activeElement === this || this.ownerDocument.activeElement === this;
      }`,
      returnByValue: true,
    }, sid)).result?.value;
    if (!activeBefore) throw new Error('Focus changed before typing; input was not sent');

    await cdp.send('Input.insertText', { text }, sid);
    const after = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(before) {
        const root = this.getRootNode();
        const active = root.activeElement === this || this.ownerDocument.activeElement === this;
        const value = this.tagName === 'INPUT' || this.tagName === 'TEXTAREA'
          ? this.value
          : this.textContent;
        return { active, changed: value !== before };
      }`,
      arguments: [{ value: focusState.before }],
      returnByValue: true,
    }, sid)).result?.value;
    if (!after?.active) throw new Error('Focus changed while typing; input result could not be verified');
    if (!after.changed) throw new Error(`Input.insertText completed but referenced <${focusState.tag}> did not change`);
    return `Typed ${text.length} characters into referenced <${focusState.tag}>`;
  });
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

export {
  clickRefStr,
  clickStr,
  clickXyStr,
  evalRawStr,
  htmlRefStr,
  htmlStr,
  loadAllStr,
  navStr,
  netStr,
  shotElementStr,
  shotRefStr,
  shotStr,
  typeRefStr,
  typeStr,
};
