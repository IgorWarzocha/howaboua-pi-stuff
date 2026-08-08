import {
	MAX_PROJECT_ENTRIES,
	MAX_PROJECT_MANIFEST_BYTES,
	type ProjectStateManifest,
} from "./project-state-format.ts";

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
    __entries.push({ name: ${JSON.stringify(name)}, kind: __kind, offset: __total, length: __bytes.byteLength });
    __parts.push(__bytes);
    __total += __bytes.byteLength;
  } catch (__error) {
    __skipped.push({ name: ${JSON.stringify(name)}, reason: String(__error instanceof Error ? __error.message : __error).slice(0, 240) });
  }`).join("");
	return `{
  const { serialize } = await import("node:v8");
  const __max = ${options.maxBytes};
  const __parts = [];
  const __entries = [];
  const __skipped = [];
  let __total = 0;
  ${captures}
  const __payload = new Uint8Array(__total);
  let __offset = 0;
  for (const __part of __parts) { __payload.set(__part, __offset); __offset += __part.byteLength; }
  const __manifest = JSON.stringify({
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    entries: __entries,
    skipped: __skipped,
  });
  if (new TextEncoder().encode(__manifest).byteLength > ${MAX_PROJECT_MANIFEST_BYTES}) {
    throw new Error("project manifest exceeds ${MAX_PROJECT_MANIFEST_BYTES} bytes");
  }
  await Deno.writeFile(${JSON.stringify(options.payloadPath)}, __payload, { mode: 0o600 });
  await Deno.writeTextFile(${JSON.stringify(options.manifestPath)}, __manifest, { mode: 0o600 });
  undefined;
}`;
}

export function projectStateRestoreSource(
	manifest: Pick<ProjectStateManifest, "deno" | "v8" | "entries">,
	payloadPath: string,
	clearNames: string[] = [],
): string {
	return `{
  const { deserialize } = await import("node:v8");
  if (Deno.version.deno !== ${JSON.stringify(manifest.deno)} || Deno.version.v8 !== ${JSON.stringify(manifest.v8)}) {
    throw new Error("project checkpoint Deno/V8 version does not match the active kernel");
  }
  const __payload = await Deno.readFile(${JSON.stringify(payloadPath)});
	const __values = [];
	const __functions = [];
	const __resolvedFunctions = [];
  for (const __entry of ${JSON.stringify(manifest.entries)}) {
    const __captured = deserialize(__payload.slice(__entry.offset, __entry.offset + __entry.length));
		if (__entry.kind === "function") __functions.push([__entry.name, __captured]);
		else __values.push([__entry.name, __captured]);
	}
	for (const [__name, __source] of __functions) {
	  __resolvedFunctions.push([__name, (0, eval)("(" + __source + ")")]);
	}
  for (const __name of ${JSON.stringify(clearNames.slice(0, MAX_PROJECT_ENTRIES))}) {
    try { delete globalThis[__name]; } catch {}
  }
  for (const [__name, __value] of __values) {
    Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
  }
	for (const [__name, __value] of __resolvedFunctions) {
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
  }
  undefined;
}`;
}
