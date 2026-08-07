import { CHECKPOINT_SCHEMA, type CheckpointManifest, type NotebookCheckpointIdentity } from "./checkpoint-format.ts";

export function checkpointSource(options: {
	candidates: string[];
	payloadPath: string;
	manifestPath: string;
	directory: string;
	identity: NotebookCheckpointIdentity;
	payload: string;
	skippedInvalid: Array<{ name: string; reason: string }>;
	maxBytes: number;
}): string {
	const captures = options.candidates.map((name) => `
  try {
    const __value = ${name};
    if (typeof __value === "function") __skip(${JSON.stringify(name)}, "function or class");
    else if (__value instanceof Promise) __skip(${JSON.stringify(name)}, "promise");
    else if (__value instanceof WeakMap || __value instanceof WeakSet) __skip(${JSON.stringify(name)}, "weak collection");
    else {
      const __bytes = serialize(__value);
      if (__bytes.byteLength > __max) __skip(${JSON.stringify(name)}, "exceeds per-variable checkpoint cap");
      else if (__total + __bytes.byteLength > __max) __skip(${JSON.stringify(name)}, "exceeds total checkpoint cap");
      else {
        __entries.push({ name: ${JSON.stringify(name)}, offset: __total, length: __bytes.byteLength });
        __parts.push(__bytes);
        __total += __bytes.byteLength;
      }
    }
  } catch (__error) {
    __skip(${JSON.stringify(name)}, __error instanceof Error ? __error.message : String(__error));
  }`).join("");
	return `{
  const { serialize } = await import("node:v8");
  const __max = ${options.maxBytes};
  const __parts = [];
  const __entries = [];
  const __skipped = ${JSON.stringify(options.skippedInvalid)};
  let __total = 0;
  const __skip = (name, reason) => __skipped.push({ name, reason: String(reason).slice(0, 240) });
  ${captures}
  const __payload = new Uint8Array(__total);
  let __offset = 0;
  for (const __part of __parts) { __payload.set(__part, __offset); __offset += __part.byteLength; }
  const __manifestPath = ${JSON.stringify(options.manifestPath)};
  let __previousPayload;
  try { __previousPayload = JSON.parse(await Deno.readTextFile(__manifestPath)).payload; } catch {}
  await Deno.writeFile(${JSON.stringify(options.payloadPath)}, __payload, { mode: 0o600 });
  const __manifest = {
    schema: ${CHECKPOINT_SCHEMA},
    project: ${JSON.stringify(options.identity.project)},
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

export function restoreSource(manifest: CheckpointManifest, payloadPath: string): string {
	return `{
  const { deserialize } = await import("node:v8");
  if (Deno.version.deno !== ${JSON.stringify(manifest.deno)} || Deno.version.v8 !== ${JSON.stringify(manifest.v8)}) {
    throw new Error("checkpoint Deno/V8 version does not match the active kernel");
  }
  const __payload = await Deno.readFile(${JSON.stringify(payloadPath)});
  const __entries = ${JSON.stringify(manifest.entries)};
	const __restored = [];
  for (const __entry of __entries) {
    const __value = deserialize(__payload.subarray(__entry.offset, __entry.offset + __entry.length));
	__restored.push([__entry.name, __value]);
  }
	for (const [__name, __value] of __restored) {
	  Object.defineProperty(globalThis, __name, { value: __value, writable: true, configurable: true, enumerable: true });
	}
  undefined;
}`;
}
