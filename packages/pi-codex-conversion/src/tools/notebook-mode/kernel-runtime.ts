const MAX_CELL_OUTPUT_CHARS = 32 * 1024 * 1024;
const MAX_CELL_OUTPUT_ITEMS = 10_000;
const MAX_TEXT_ITEM_CHARS = 4 * 1024 * 1024;

export function notebookBootstrapSource(origin: string, token: string, exitToken: string, cwd: string): string {
	return `{
	Deno.chdir(${JSON.stringify(cwd)});
  const __origin = ${JSON.stringify(origin)};
  const __token = ${JSON.stringify(token)};
  const __fetch = globalThis.fetch.bind(globalThis);
  const { getHeapStatistics: __getHeapStatistics } = await import("node:v8");
	const __parentPid = Deno.ppid;
	setInterval(() => {
	  if (Deno.ppid !== __parentPid) Deno.exit(70);
	}, 5000);
  const __state = {
    cellId: null,
    requestId: 0,
    pending: new Set(),
	pendingErrors: [],
	toolPending: new Set(),
	toolNames: {},
	outputChars: 0,
	outputItems: 0,
	outputTruncated: false,
    store: new Map(),
    tools: undefined,
    memoryTimer: undefined,
	cellGlobals: new Set(),
	projectBindings: new Set(),
  };
  const __decode = (_key, value) => {
    if (!value || typeof value !== "object") return value;
    if (value.__pi_type === "bigint") return BigInt(value.value);
    if (value.__pi_type === "bytes") return Uint8Array.from(atob(value.value), (char) => char.charCodeAt(0));
    return value;
  };
  const __post = async (payload) => {
    const response = await __fetch(__origin + "/bridge", {
      method: "POST",
      headers: { authorization: "Bearer " + __token, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const value = text ? JSON.parse(text, __decode) : {};
    if (!response.ok || !value.ok) throw new Error(value.error || "Notebook bridge request failed");
    return value.result;
  };
  const __track = (promise) => {
    __state.pending.add(promise);
	void promise.then(
	  () => __state.pending.delete(promise),
	  (error) => {
		__state.pending.delete(promise);
		__state.pendingErrors.push(error);
	  },
	);
    return promise;
  };
	const __trackTool = (promise) => {
	  __state.toolPending.add(promise);
	  void promise.then(
		() => __state.toolPending.delete(promise),
		() => __state.toolPending.delete(promise),
	  );
	  return promise;
	};
  const __stringify = (value) => {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const __emit = (items) => {
    if (!__state.cellId) throw new Error("Notebook helper called outside an active exec cell");
	if (__state.outputTruncated) return;
	const accepted = [];
	const expanded = [];
	for (const item of items) {
	  if (item.type !== "input_text" || !item.text || item.text.length <= ${MAX_TEXT_ITEM_CHARS}) {
		expanded.push(item);
		continue;
	  }
	  for (let offset = 0; offset < item.text.length;) {
		let end = Math.min(item.text.length, offset + ${MAX_TEXT_ITEM_CHARS});
		const before = item.text.charCodeAt(end - 1);
		const after = item.text.charCodeAt(end);
		if (end < item.text.length && before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) end -= 1;
		expanded.push({ ...item, text: item.text.slice(offset, end) });
		offset = end;
	  }
	}
	for (const item of expanded) {
	  const size = item.type === "input_text" ? (item.text?.length || 0) : (item.image_url?.length || 0);
	  if (__state.outputItems >= ${MAX_CELL_OUTPUT_ITEMS} || __state.outputChars + size > ${MAX_CELL_OUTPUT_CHARS}) {
		const notice = { type: "input_text", text: "[Notebook cell output truncated]" };
		accepted.push(notice);
		__state.outputChars += notice.text.length;
		__state.outputItems += 1;
		__state.outputTruncated = true;
		break;
	  }
	  accepted.push(item);
	  __state.outputChars += size;
	  __state.outputItems += 1;
	}
	for (const item of accepted) __track(__post({ kind: "emit", cellId: __state.cellId, items: [item] }));
  };
  const __reportMemory = async (cellId) => {
    const usage = Deno.memoryUsage();
    await __post({
      kind: "memory",
      cellId,
      usage: {
        heapUsedBytes: usage.heapUsed,
        heapTotalBytes: usage.heapTotal,
        rssBytes: usage.rss,
        externalBytes: usage.external,
		heapLimitBytes: __getHeapStatistics().heap_size_limit,
      },
    });
  };
  const __image = (value, detail) => {
    let image_url;
	let embeddedDetail;
	if (typeof value === "string") image_url = value;
    else if (value && typeof value.image_url === "string") {
      image_url = value.image_url;
	  embeddedDetail = value.detail;
    } else if (value && value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
	  if (!value.data) throw new TypeError("image expected MCP image data");
	  image_url = value.data.toLowerCase().startsWith("data:")
		? value.data
		: "data:" + (value.mimeType || "application/octet-stream") + ";base64," + value.data;
	  const metadataDetail = value._meta?.["codex/imageDetail"];
	  embeddedDetail = ["auto", "low", "high", "original"].includes(metadataDetail) ? metadataDetail : undefined;
    } else throw new TypeError("image expects a data URL or image content item");
	if (!image_url || !/^data:/i.test(image_url)) {
	  if (/^https?:/i.test(image_url || "")) throw new TypeError("remote image URLs are not supported; pass a base64 data URI instead");
	  throw new TypeError("invalid image output; pass a base64 data URI instead");
	}
	if (!/^data:[a-z0-9.+-]+\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(image_url)) throw new TypeError("invalid image output; expected base64 image data");
	const requestedDetail = detail !== undefined ? detail : embeddedDetail;
	let resolvedDetail = "high";
	if (requestedDetail !== undefined && requestedDetail !== null) {
	  if (typeof requestedDetail !== "string") throw new TypeError("image detail must be a string when provided");
	  resolvedDetail = requestedDetail.toLowerCase();
	  if (!["auto", "low", "high", "original"].includes(resolvedDetail)) {
		throw new TypeError("image detail must be one of: auto, low, high, original");
	  }
	}
	__emit([{ type: "input_image", image_url, detail: resolvedDetail }]);
  };
  const __tools = new Proxy({}, {
    ownKeys() {
      return Object.keys(__state.toolNames);
    },
    has(_target, name) {
      return Object.hasOwn(__state.toolNames, name);
    },
    getOwnPropertyDescriptor(_target, name) {
      if (!Object.hasOwn(__state.toolNames, name)) return undefined;
      return { configurable: true, enumerable: true };
    },
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      return (input) => {
        if (!__state.cellId) throw new Error("Nested tool called outside an active exec cell");
        const requestId = ++__state.requestId;
		const toolName = __state.toolNames[name] || { name };
		return __trackTool(__post({ kind: "tool", cellId: __state.cellId, requestId, toolName, input }));
      };
    },
  });
  const __runtime = {
    async begin(cellId, tools, toolNames) {
	  if (__state.memoryTimer !== undefined) clearInterval(__state.memoryTimer);
      __state.cellId = cellId;
	  __state.toolNames = toolNames;
      __state.pending = new Set();
	  __state.pendingErrors = [];
	  __state.toolPending = new Set();
	  __state.outputChars = 0;
	  __state.outputItems = 0;
	  __state.outputTruncated = false;
      globalThis.tools = __tools;
      globalThis.ALL_TOOLS = tools;
	  __state.cellGlobals = new Set(Object.getOwnPropertyNames(globalThis));
	  await __reportMemory(cellId);
	  __state.memoryTimer = setInterval(() => void __reportMemory(cellId).catch(() => undefined), 1000);
    },
    async flush(cellId) {
      if (__state.cellId !== cellId) throw new Error("Notebook cell identity changed while executing");
	  await Promise.allSettled([...__state.pending]);
	  const [error] = __state.pendingErrors.splice(0);
	  if (error) throw error;
	  await __post({ kind: "cancel_tools", cellId });
	  await Promise.allSettled([...__state.toolPending]);
	  await __reportMemory(cellId);
    },
    async finish(cellId) {
      if (__state.cellId !== cellId) return;
	  try {
		await this.flush(cellId);
		for (const __name of Object.getOwnPropertyNames(globalThis)) {
		  if (!__state.cellGlobals.has(__name)) __state.projectBindings.add(__name);
		}
	  } finally { this.end(cellId); }
    },
    end(cellId) {
	  if (__state.cellId !== cellId) return;
	  if (__state.memoryTimer !== undefined) clearInterval(__state.memoryTimer);
	  __state.memoryTimer = undefined;
	  __state.cellId = null;
    },
	projectBindings() {
	  return [...__state.projectBindings].sort();
	},
	promote(names) {
	  for (const name of names) {
		if (typeof name !== "string") throw new TypeError("project binding name must be a string");
		__state.projectBindings.add(name);
	  }
	},
	syncProjectBindings(names) {
	  __state.projectBindings = new Set(names);
	},
  };
  Object.defineProperty(globalThis, "__piNotebook", { value: __runtime, configurable: false });
  globalThis.tools = __tools;
  globalThis.ALL_TOOLS = [];
  globalThis.text = (value) => __emit([{ type: "input_text", text: __stringify(value) }]);
  globalThis.image = __image;
  globalThis.generatedImage = (value) => {
    if (!value || typeof value.image_url !== "string") throw new TypeError("generatedImage expects an image result");
	if (value.output_hint !== undefined && typeof value.output_hint !== "string") throw new TypeError("generatedImage output_hint must be a string when provided");
    __image(value.image_url);
	if (value.output_hint !== undefined) globalThis.text(value.output_hint);
  };
  globalThis.notify = (value) => {
    const text = __stringify(value);
    if (!text.trim()) throw new TypeError("notify expects non-empty text");
    if (!__state.cellId) throw new Error("notify called outside an active exec cell");
    __track(__post({ kind: "notify", cellId: __state.cellId, text }));
  };
  globalThis.yield_control = () => {
    if (!__state.cellId) throw new Error("yield_control called outside an active exec cell");
    __track(__post({ kind: "yield", cellId: __state.cellId }));
  };
  globalThis.exit = () => {
	const error = new Error(${JSON.stringify(exitToken)});
	error.name = "PiNotebookExit";
	throw error;
  };
  globalThis.store = (key, value) => {
    if (typeof key !== "string") throw new TypeError("store key must be a string");
    const encoded = JSON.stringify(value);
    __state.store.set(key, encoded === undefined ? undefined : JSON.parse(encoded));
  };
  globalThis.load = (key) => {
    if (typeof key !== "string") throw new TypeError("load key must be a string");
    const value = __state.store.get(key);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  };
}`;
}

export function notebookExampleSource(marker: string, occupied = false): string {
	return `{
	  const __conflict = ${occupied} || "foo" in globalThis || "bar" in globalThis;
  let __injected = [];
  if (!__conflict) {
    const __foo = [
      { id: "alpha", value: "first example record" },
      { id: "bravo", value: "second example record" },
    ];
    const __bar = (__item) => Object.fromEntries(Object.entries(__item).slice(0, 4));
    Object.defineProperties(__foo, {
      description: { value: "Example records for reusable helper patterns", writable: true, configurable: true },
      usage: { value: "Inspect: foo.map((item, index) => ({ index, keys: Object.keys(item) }))", writable: true, configurable: true },
    });
    Object.defineProperties(__bar, {
      description: { value: "Summarize one foo item without mutating foo", writable: true, configurable: true },
      usage: { value: "Inspect: foo.map((item, index) => ({ index, keys: Object.keys(item) }))\\nRun: bar(foo[index])", writable: true, configurable: true },
    });
    try {
      Object.defineProperties(globalThis, {
        foo: { value: __foo, writable: true, configurable: true, enumerable: true },
        bar: { value: __bar, writable: true, configurable: true, enumerable: true },
      });
      __injected = ["foo", "bar"];
    } catch {
      delete globalThis.foo;
      delete globalThis.bar;
    }
  }
  console.log(${JSON.stringify(marker)} + JSON.stringify(__injected));
  undefined;
}`;
}
