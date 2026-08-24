import { sleep, TIMEOUT } from './runtime.mjs';

const RETRYABLE_TIMEOUT_METHODS = new Set([
  'Accessibility.getFullAXTree',
  'Page.captureScreenshot',
  'Runtime.enable',
]);

class CDPTimeoutError extends Error {}

export function cdpTimeoutAttempts(method) {
  return RETRYABLE_TIMEOUT_METHODS.has(method) ? 2 : 1;
}

function commandTimeoutError(method, attempts) {
  const seconds = TIMEOUT / 1000;
  if (attempts > 1) {
    return new Error(`Chrome did not answer ${method} after two ${seconds}s attempts. The tab may be unresponsive or suspended.`);
  }
  if (method === 'Runtime.evaluate') {
    return new Error(`Chrome did not answer Runtime.evaluate within ${seconds}s. The expression or awaited promise may still be running; check its effect before retrying.`);
  }
  return new Error(`Chrome did not answer ${method} within ${seconds}s.`);
}

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

  async send(method, params = {}, sessionId) {
    const attempts = cdpTimeoutAttempts(method);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.#sendOnce(method, params, sessionId);
      } catch (error) {
        if (!(error instanceof CDPTimeoutError)) throw error;
        if (attempt === attempts) throw commandTimeoutError(method, attempts);
        await sleep(100);
      }
    }
  }

  #sendOnce(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new CDPTimeoutError(method));
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

export { CDP };
