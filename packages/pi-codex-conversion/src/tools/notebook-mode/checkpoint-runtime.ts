import { CHECKPOINT_SCHEMA, type CheckpointManifest, type NotebookCheckpointIdentity } from "./checkpoint-format.ts";
import {
	MAX_PROJECT_DESCRIPTION_BYTES,
	MAX_PROJECT_MANIFEST_BYTES,
	MAX_PROJECT_USAGE_BYTES,
	MAX_PROJECT_USAGE_LINES,
} from "./project-state-format.ts";

export function checkpointSource(options: {
	candidates: string[];
	payloadPath: string;
	manifestPath: string;
	directory: string;
	identity: NotebookCheckpointIdentity;
	projectGeneration: string;
	projectNames: string[];
	payload: string;
	previousPayload?: string | undefined;
	skippedInvalid: Array<{ name: string; reason: string }>;
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
    if (__captured instanceof Promise) __skip(${JSON.stringify(name)}, "promise");
    else if (__value instanceof WeakMap || __value instanceof WeakSet) __skip(${JSON.stringify(name)}, "weak collection");
    else {
      const __bytes = serialize(__captured);
      if (__bytes.byteLength > __max) __skip(${JSON.stringify(name)}, "exceeds per-variable checkpoint cap");
      else if (__total + __bytes.byteLength > __max) __skip(${JSON.stringify(name)}, "exceeds total checkpoint cap");
      else {
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
      }
    }
  } catch (__error) {
    __skip(${JSON.stringify(name)}, __error instanceof Error ? __error.message : String(__error));
  }`).join("");
	return `{
  const { serialize } = await import("node:v8");
  const __max = ${options.maxBytes};
  const __entries = [];
  const __skipped = ${JSON.stringify(options.skippedInvalid)};
  let __total = 0;
  const __readBindingMetadata = (__value) => {
    if (__value === null || (typeof __value !== "object" && typeof __value !== "function")) return {};
    const __metadata = {};
    for (const [__key, __max, __multiline, __lines] of [
      ["description", ${MAX_PROJECT_DESCRIPTION_BYTES}, false, 1],
      ["usage", ${MAX_PROJECT_USAGE_BYTES}, true, ${MAX_PROJECT_USAGE_LINES}],
    ]) {
      const __descriptor = Object.getOwnPropertyDescriptor(__value, __key);
      if (!__descriptor || !("value" in __descriptor) || typeof __descriptor.value !== "string") continue;
      const __text = __descriptor.value;
      if (!__text || new TextEncoder().encode(__text).byteLength > __max || __text.includes("\\r")) continue;
      const __textLines = __text.split("\\n");
      if (__textLines.length > __lines) continue;
      let __valid = true;
      for (const __character of __text) {
        const __codePoint = __character.codePointAt(0);
        if ((__codePoint < 0x20 && __codePoint !== 0x0a) || __codePoint === 0x7f || !__multiline && __codePoint === 0x0a) {
          __valid = false;
          break;
        }
      }
      if (__valid) __metadata[__key] = __text;
    }
    return __metadata;
  };
  const __skip = (name, reason) => __skipped.push({ name, reason: String(reason).slice(0, 240) });
	const __file = await Deno.open(${JSON.stringify(options.payloadPath)}, { create: true, write: true, truncate: true, mode: 0o600 });
	const __writeAll = async (__bytes) => {
	  let __offset = 0;
	  while (__offset < __bytes.byteLength) {
		const __written = await __file.write(__bytes.subarray(__offset));
		if (__written === 0) throw new Error("checkpoint payload write made no progress");
		__offset += __written;
  }
	};
	try { ${captures} } finally { __file.close(); }
  const __manifestPath = ${JSON.stringify(options.manifestPath)};
  const __previousPayload = ${JSON.stringify(options.previousPayload)};
  const __manifest = {
    schema: ${CHECKPOINT_SCHEMA},
    project: ${JSON.stringify(options.identity.project)},
	projectGeneration: ${JSON.stringify(options.projectGeneration)},
	projectNames: ${JSON.stringify(options.projectNames)},
    session: ${JSON.stringify(options.identity.session)},
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    payload: ${JSON.stringify(options.payload)},
    createdAt: new Date().toISOString(),
    entries: __entries,
    skipped: __skipped,
  };
  const __temporaryManifest = __manifestPath + "." + crypto.randomUUID() + ".tmp";
  const __manifestText = JSON.stringify(__manifest, null, 2) + "\\n";
  if (new TextEncoder().encode(__manifestText).byteLength > ${MAX_PROJECT_MANIFEST_BYTES}) {
    throw new Error("notebook checkpoint manifest exceeds ${MAX_PROJECT_MANIFEST_BYTES} bytes");
  }
  await Deno.writeTextFile(__temporaryManifest, __manifestText, { mode: 0o600 });
  await Deno.rename(__temporaryManifest, __manifestPath);
  if (__previousPayload && __previousPayload !== __manifest.payload) {
    await Deno.remove(${JSON.stringify(options.directory)} + "/" + __previousPayload).catch(() => {});
  }
  undefined;
}`;
}

export function restoreSource(manifest: CheckpointManifest, payloadPath: string, excludeNames: ReadonlySet<string> = new Set()): string {
	return `{
  const { deserialize } = await import("node:v8");
  if (Deno.version.deno !== ${JSON.stringify(manifest.deno)} || Deno.version.v8 !== ${JSON.stringify(manifest.v8)}) {
    throw new Error("checkpoint Deno/V8 version does not match the active kernel");
  }
  const __payload = await Deno.readFile(${JSON.stringify(payloadPath)});
	const __excluded = new Set(${JSON.stringify([...excludeNames])});
	const __entries = ${JSON.stringify(manifest.entries)}.filter(({ name }) => !__excluded.has(name));
	const __values = [];
	const __functions = [];
  for (const __entry of __entries) {
	const __captured = deserialize(__payload.slice(__entry.offset, __entry.offset + __entry.length));
	if (__entry.kind === "function") __functions.push([__entry.name, __captured, __entry]);
	else __values.push([__entry.name, __captured, __entry]);
	}
	const __applyMetadata = (__value, __entry) => {
	  if (__value === null || (typeof __value !== "object" && typeof __value !== "function")) return;
	  for (const __key of ["description", "usage"]) {
	    if (typeof __entry[__key] !== "string") continue;
	    try {
	      Object.defineProperty(__value, __key, {
	        value: __entry[__key],
	        writable: true,
	        configurable: true,
	        enumerable: true,
	      });
	    } catch {}
	  }
	};
	for (const [__name, __value, __entry] of __values) {
	  __applyMetadata(__value, __entry);
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
	}
	for (const [__name, __source, __entry] of __functions) {
	  const __value = (0, eval)("(" + __source + ")");
	  __applyMetadata(__value, __entry);
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
	}
  undefined;
}`;
}
