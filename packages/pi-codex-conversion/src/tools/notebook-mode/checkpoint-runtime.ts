import { CHECKPOINT_SCHEMA, type CheckpointManifest, type NotebookCheckpointIdentity } from "./checkpoint-format.ts";

export function checkpointSource(options: {
	candidates: string[];
	payloadPath: string;
	manifestPath: string;
	directory: string;
	identity: NotebookCheckpointIdentity;
	projectGeneration: string;
	projectNames: string[];
	payload: string;
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
		await __writeAll(__bytes);
		__entries.push({ name: ${JSON.stringify(name)}, kind: __kind, offset: __total, length: __bytes.byteLength });
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
  let __previousPayload;
  try { __previousPayload = JSON.parse(await Deno.readTextFile(__manifestPath)).payload; } catch {}
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
  await Deno.writeTextFile(__temporaryManifest, JSON.stringify(__manifest, null, 2) + "\\n", { mode: 0o600 });
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
	if (__entry.kind === "function") __functions.push([__entry.name, __captured]);
	else __values.push([__entry.name, __captured]);
  }
	for (const [__name, __value] of __values) {
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
	}
	for (const [__name, __source] of __functions) {
	  const __value = (0, eval)("(" + __source + ")");
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
	}
  undefined;
}`;
}
