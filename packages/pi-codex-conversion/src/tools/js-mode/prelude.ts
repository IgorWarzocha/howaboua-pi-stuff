import { commandOutputFormatterSource } from "../code-mode/command-output.ts";

// Adapts Pi v1.4's tools-only JSON bridge and output-helper approach for a
// persistent global-script context. No per-cell async-function wrapper: lexical
// declarations and their closures belong to the VM and its native snapshots.
export const JS_PRELUDE = String.raw`(bridge => {
  const parse = JSON.parse, stringify = JSON.stringify;
  const then = Function.prototype.call.bind(Promise.prototype.then);
  const formatCommand = ${commandOutputFormatterSource};
  const pending = new Map(), stored = new Map(), outputs = new WeakMap();
  const EXIT = Object.freeze({});
  let next = 0, done = false, failure, tools = Object.freeze({}), metadata = [];
  const describe = e => { try { return e instanceof Error ? String(e.name) + ': ' + String(e.message) : String(e); } catch { return 'The cell threw a value that cannot be described'; } };
  const format = value => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return describe(value);
    try { return stringify(value, (_, v) => typeof v === 'bigint' ? String(v) + 'n' : v, 2) ?? String(value); }
    catch { return String(value); }
  };
  const text = value => bridge('text', outputs.has(value) && typeof value.output === 'string' ? formatCommand(value, outputs.get(value)) : format(value));
  const image = (value, detail) => {
    let url = typeof value === 'string' ? value : value?.image_url;
    if (!url && value?.type === 'image' && typeof value.data === 'string' && typeof value.mimeType === 'string')
      url = value.data.startsWith('data:') ? value.data : 'data:' + value.mimeType + ';base64,' + value.data;
    if (typeof url !== 'string' || !/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(url)) throw new TypeError('image expects base64 image data; remote image URLs are unavailable');
    detail ??= value?.detail ?? value?._meta?.['codex/imageDetail'] ?? 'high';
    if (!['auto','low','high','original'].includes(detail)) throw new TypeError('Invalid image detail');
    bridge('image', stringify({ type: 'input_image', image_url: url, detail }));
  };
  const helpers = {
    text, image,
    generatedImage: value => { image(value); if (value?.output_hint !== undefined) text(value.output_hint); },
    notify: value => bridge('notify', format(value)),
    yield_control: async () => { bridge('yield', ''); },
    exit: () => { throw EXIT; },
    store: (key, value) => { if (typeof key !== 'string') throw new TypeError('store key must be a string'); stored.set(key, value); },
    load: key => stored.get(key),
    console: Object.freeze(Object.fromEntries(['log','info','warn','error','debug'].map(name => [name, (...args) => text(args.map(format).join(' '))])))
  };
  for (const [name, value] of Object.entries(helpers)) Object.defineProperty(globalThis, name, { value, configurable: false, writable: false });
  Object.defineProperty(globalThis, 'tools', { get: () => tools });
  Object.defineProperty(globalThis, 'ALL_TOOLS', { get: () => metadata });
  return Object.freeze({
    configure(json) {
      done = false; failure = undefined;
      const definitions = parse(json), table = Object.create(null);
      for (const tool of definitions) table[tool.exposed] = (...args) => new Promise((resolve, reject) => {
        const value = args.length <= 1 ? args[0] : args;
        const json = value === undefined ? '' : stringify(value);
        const id = ++next;
        pending.set(id, { resolve, reject, output: tool.output });
        try { bridge('call', stringify({ id, name: tool.name, json })); }
        catch (e) { pending.delete(id); reject(e); }
      });
      tools = Object.freeze(table);
      metadata = Object.freeze(definitions.filter(t => t.description !== undefined).map(t => Object.freeze({ name: t.exposed, description: t.description })));
    },
    observe(promise) { then(promise, () => { done = true; }, error => { done = true; if (error !== EXIT) failure = describe(error); }); },
    settle(id, json, error) {
      const request = pending.get(id); if (!request) throw new Error('Unknown tool result');
      pending.delete(id);
      if (error !== undefined) request.reject(new Error(error));
      else {
        const value = json === '' ? undefined : parse(json);
        if (request.output && value !== null && typeof value === 'object') outputs.set(value, request.output === 'plain-command');
        request.resolve(value);
      }
    },
    status() { return stringify({ done, error: failure, pending: pending.size }); }
  });
})`;
