import { BINDING_METADATA_READER_SOURCE, BINDING_METADATA_RESTORE_SOURCE } from "./binding-metadata-source.ts";
import {
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	type ProjectStateManifest,
} from "./project-state-format.ts";
import type { KernelExecutionResult } from "./jupyter-kernel.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function projectBindingNamesSource(marker: string): string {
	return `if (typeof globalThis.__piNotebook?.projectBindings !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.projectBindings"); console.log(${JSON.stringify(marker)} + JSON.stringify(globalThis.__piNotebook.projectBindings())); undefined;`;
}

export function parseProjectBindingNames(result: KernelExecutionResult, marker: string): string[] {
	if (result.status !== "ok") throw new Error(result.errorText ?? "Project binding selection failed");
	const output = result.items.filter(({ type }) => type === "input_text").map(({ text }) => text ?? "").join("");
	const start = output.indexOf(marker);
	if (start === -1) throw new Error("Project binding selection returned no result");
	try {
		const value = JSON.parse(output.slice(start + marker.length).split("\n", 1)[0]!) as unknown;
		if (!Array.isArray(value) || value.length > MAX_PROJECT_ENTRIES || !value.every((name) => typeof name === "string" && IDENTIFIER.test(name))) {
			throw new Error("invalid project binding list");
		}
		return [...new Set(value)].sort();
	} catch (error) {
		throw new Error(`Project binding selection returned an invalid result: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function promoteProjectBindingsSource(names: string[]): string {
	return `if (typeof globalThis.__piNotebook?.promote !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.promote"); globalThis.__piNotebook.promote(${JSON.stringify(names)}); undefined;`;
}

export function syncProjectBindingsSource(names: string[]): string {
	return `if (typeof globalThis.__piNotebook?.syncProjectBindings !== "function") throw new Error("Notebook runtime bootstrap unavailable: __piNotebook.syncProjectBindings"); globalThis.__piNotebook.syncProjectBindings(${JSON.stringify(names)}); undefined;`;
}

export function projectStateCaptureSource(options: {
	candidates: string[];
	payloadPath: string;
	manifestPath: string;
	maxBytes: number;
}): string {
	const captures = options.candidates.map((name) => `
  try {
    const __value = ${name};
    let __kind = "value";
    let __captured = __value;
    if (typeof __value === "function") {
      const __source = Function.prototype.toString.call(__value);
      if (__source.includes("[native code]")) throw new Error("native or bound function");
      const __candidate = (0, eval)("(" + __source + ")");
      if (typeof __candidate !== "function") throw new Error("function source did not reanimate");
      __kind = "function";
      __captured = __source;
    }
    if (__captured instanceof Promise) throw new Error("promise");
    if (__value instanceof WeakMap || __value instanceof WeakSet) throw new Error("weak collection");
    const __bytes = serialize(__captured);
    if (__bytes.byteLength > __max) throw new Error("exceeds per-value checkpoint cap");
    if (__total + __bytes.byteLength > __max) throw new Error("exceeds total project checkpoint cap");
	const __metadata = __readBindingMetadata(__value);
	await __writeAll(__bytes);
	    __entries.push({
	      name: ${JSON.stringify(name)},
	      kind: __kind,
	      offset: __total,
	      length: __bytes.byteLength,
	      ...(__metadata.description === undefined ? {} : { description: __metadata.description }),
	      ...(__metadata.usage === undefined ? {} : { usage: __metadata.usage }),
	    });
    __total += __bytes.byteLength;
  } catch (__error) {
    __skipped.push({ name: ${JSON.stringify(name)}, reason: String(__error instanceof Error ? __error.message : __error).slice(0, 240) });
  }`).join("");
	return `{
  const { serialize } = await import("node:v8");
  const __max = ${options.maxBytes};
	  const __entries = [];
	  const __skipped = [];
	  let __total = 0;
${BINDING_METADATA_READER_SOURCE}
	const __file = await Deno.open(${JSON.stringify(options.payloadPath)}, { create: true, write: true, truncate: true, mode: 0o600 });
	const __writeAll = async (__bytes) => {
	  let __offset = 0;
	  while (__offset < __bytes.byteLength) {
		const __written = await __file.write(__bytes.subarray(__offset));
		if (__written === 0) throw new Error("project payload write made no progress");
		__offset += __written;
	  }
	};
	try { ${captures} } finally { __file.close(); }
  const __manifest = JSON.stringify({
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    entries: __entries,
    skipped: __skipped,
  });
  if (new TextEncoder().encode(__manifest).byteLength > ${MAX_PROJECT_MANIFEST_BYTES}) {
    throw new Error("project manifest exceeds ${MAX_PROJECT_MANIFEST_BYTES} bytes");
  }
  await Deno.writeTextFile(${JSON.stringify(options.manifestPath)}, __manifest, { mode: 0o600 });
  undefined;
}`;
}

export function projectStateRestoreSource(
	manifest: Pick<ProjectStateManifest, "deno" | "v8" | "entries">,
	payloadPath: string,
	clearNames: string[] = [],
): string {
	const bindingNames = [...new Set([
		...manifest.entries.map(({ name }) => name),
		...clearNames,
	])].slice(0, MAX_PROJECT_ENTRIES);
	const currentBindings = bindingNames.map((name) => `
  try { __current.set(${JSON.stringify(name)}, ${name}); } catch {}`).join("");
	return `{
  const { deserialize, serialize } = await import("node:v8");
  if (${manifest.entries.length > 0} && (Deno.version.deno !== ${JSON.stringify(manifest.deno)} || Deno.version.v8 !== ${JSON.stringify(manifest.v8)})) {
    throw new Error("project checkpoint Deno/V8 version does not match the active kernel");
  }
  const __payload = await Deno.readFile(${JSON.stringify(payloadPath)});
  const __restores = [];
  for (const __entry of ${JSON.stringify(manifest.entries)}) {
    const __captured = deserialize(__payload.slice(__entry.offset, __entry.offset + __entry.length));
    const __value = __entry.kind === "function" ? (0, eval)("(" + __captured + ")") : __captured;
    __restores.push({ ...__entry, captured: __captured, value: __value });
  }
  const __current = new Map();
  ${currentBindings}
  const __sameBytes = (__left, __right) => {
    try {
      const __a = serialize(__left);
      const __b = serialize(__right);
      return __a.byteLength === __b.byteLength && __a.every((__byte, __index) => __byte === __b[__index]);
    } catch { return Object.is(__left, __right); }
  };
  const __matches = (__currentValue, __restore) => __restore.kind === "function"
    ? typeof __currentValue === "function" && Function.prototype.toString.call(__currentValue) === __restore.captured
    : __sameBytes(__currentValue, __restore.value);
${BINDING_METADATA_RESTORE_SOURCE}
  const __slot = "__piNotebookRebind_" + crypto.randomUUID().replaceAll("-", "");
  const __assign = (__name, __value) => {
    globalThis[__slot] = __value;
    try { (0, eval)(__name + " = globalThis[" + JSON.stringify(__slot) + "]"); }
    finally { delete globalThis[__slot]; }
  };
  const __restoreNames = new Set(__restores.map(({ name }) => name));
  const __deletions = ${JSON.stringify(clearNames.slice(0, MAX_PROJECT_ENTRIES))}.filter((__name) => !__restoreNames.has(__name));
  const __blocked = [];
  for (const __name of __deletions) {
    if (!__current.has(__name)) continue;
    const __descriptor = Object.getOwnPropertyDescriptor(globalThis, __name);
    if (!__descriptor?.configurable) __blocked.push(__name);
  }
  for (const __restore of __restores) {
    if (!__current.has(__restore.name) || __matches(__current.get(__restore.name), __restore)) continue;
    try { __assign(__restore.name, __current.get(__restore.name)); }
    catch { __blocked.push(__restore.name); }
  }
  if (__blocked.length > 0) {
    throw new Error("project bindings require a notebook restart: " + [...new Set(__blocked)].join(", "));
  }
  for (const __name of __deletions) delete globalThis[__name];
  for (const __restore of __restores) {
    if (__current.has(__restore.name)) {
      if (!__matches(__current.get(__restore.name), __restore)) __assign(__restore.name, __restore.value);
      __applyMetadata(globalThis[__restore.name], __restore);
      continue;
    }
    __applyMetadata(__restore.value, __restore);
    Object.defineProperty(globalThis, __restore.name, {
      value: __restore.value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
	globalThis.__piNotebook.syncProjectBindings(${JSON.stringify(manifest.entries.map(({ name }) => name))});
  undefined;
}`;
}
