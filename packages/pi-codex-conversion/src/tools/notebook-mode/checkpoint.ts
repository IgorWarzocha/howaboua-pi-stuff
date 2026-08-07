import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, type Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { DenoJupyterKernel } from "./jupyter-kernel.ts";

export const NOTEBOOK_CHECKPOINT_MAX_BYTES = 256 * 1024 * 1024;
const NOTEBOOK_CHECKPOINT_MIN_BYTES = 8 * 1024 * 1024;
const CHECKPOINT_SCHEMA = 1;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PAYLOAD_NAME = /^checkpoint-[0-9a-f-]+\.bin$/;
const CHECKPOINT_DIRECTORY_NAME = /^[0-9a-f]{64}$/;

interface CheckpointEntry {
	name: string;
	offset: number;
	length: number;
}

interface CheckpointManifest {
	schema: number;
	project: string;
	session: string;
	deno: string;
	v8: string;
	payload: string;
	createdAt: string;
	entries: CheckpointEntry[];
	skipped: Array<{ name: string; reason: string }>;
}

export interface NotebookCheckpointIdentity {
	project: string;
	session: string;
	agentDir: string;
}

export interface NotebookCheckpointSummary {
	restored: string[];
	skipped: Array<{ name: string; reason: string }>;
	message?: string | undefined;
}

export function resolveNotebookCheckpointMaxBytes(maxHeapMiB: number): number {
	const heapRelative = Math.floor(maxHeapMiB * 1024 * 1024 / 8);
	return Math.min(NOTEBOOK_CHECKPOINT_MAX_BYTES, Math.max(NOTEBOOK_CHECKPOINT_MIN_BYTES, heapRelative));
}

export function garbageCollectSupersededNotebookCheckpoints(identity: NotebookCheckpointIdentity): void {
	const current = checkpointPaths(identity).directory;
	const sessions = resolve(current, "..");
	const family = sessionFamily(identity.session);
	let entries: Dirent[];
	try {
		entries = readdirSync(sessions, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || !CHECKPOINT_DIRECTORY_NAME.test(entry.name)) continue;
		const directory = join(sessions, entry.name);
		if (directory === current) continue;
		const manifest = readManifest(join(directory, "checkpoint.json"));
		if (!manifest || manifest.project !== identity.project || sessionFamily(manifest.session) !== family) continue;
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function writeNotebookCheckpoint(
	kernel: DenoJupyterKernel,
	identity: NotebookCheckpointIdentity,
	baselineNames: ReadonlySet<string>,
	maxBytes: number,
): Promise<CheckpointManifest> {
	const paths = checkpointPaths(identity);
	mkdirSync(paths.directory, { recursive: true });
	const names = [...new Set(await kernel.complete("", 0))].sort();
	const skippedInvalid = names
		.filter((name) => !baselineNames.has(name) && !IDENTIFIER.test(name))
		.map((name) => ({ name, reason: "unsupported identifier" }));
	const candidates = names.filter((name) => !baselineNames.has(name) && IDENTIFIER.test(name));
	const payload = `checkpoint-${randomUUID()}.bin`;
	const source = checkpointSource({
		candidates,
		payloadPath: join(paths.directory, payload),
		manifestPath: paths.manifest,
		identity,
		payload,
		skippedInvalid,
		maxBytes,
	});
	const result = await kernel.execute(source);
	if (result.status !== "ok") throw new Error(`Notebook checkpoint failed: ${result.errorText ?? "unknown error"}`);
	const manifest = readManifest(paths.manifest);
	if (!manifest) throw new Error("Notebook checkpoint did not produce a valid manifest");
	return manifest;
}

export async function restoreNotebookCheckpoint(
	kernel: DenoJupyterKernel,
	identity: NotebookCheckpointIdentity,
	maxBytes: number,
): Promise<NotebookCheckpointSummary> {
	const paths = checkpointPaths(identity);
	if (!existsSync(paths.manifest)) return { restored: [], skipped: [] };
	const manifest = readManifest(paths.manifest);
	if (!manifest) return { restored: [], skipped: [], message: "Notebook checkpoint was invalid and was not restored" };
	if (
		manifest.schema !== CHECKPOINT_SCHEMA
		|| manifest.project !== identity.project
		|| manifest.session !== identity.session
	) {
		return { restored: [], skipped: manifest.skipped, message: "Notebook checkpoint identity was incompatible and was not restored" };
	}
	const payloadPath = join(paths.directory, manifest.payload);
	if (!isValidCheckpointPayload(manifest, payloadPath, maxBytes)) {
		return { restored: [], skipped: manifest.skipped, message: "Notebook checkpoint payload was missing or invalid and was not restored" };
	}
	const result = await kernel.execute(restoreSource(manifest, payloadPath));
	if (result.status !== "ok") {
		return {
			restored: [],
			skipped: manifest.skipped,
			message: `Notebook checkpoint was incompatible and was not restored: ${result.errorText ?? "unknown error"}`,
		};
	}
	return { restored: manifest.entries.map((entry) => entry.name), skipped: manifest.skipped };
}

function checkpointSource(options: {
	candidates: string[];
	payloadPath: string;
	manifestPath: string;
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
    await Deno.remove(${JSON.stringify(checkpointPaths(options.identity).directory)} + "/" + __previousPayload).catch(() => {});
  }
  undefined;
}`;
}

function restoreSource(manifest: CheckpointManifest, payloadPath: string): string {
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

function checkpointPaths(identity: NotebookCheckpointIdentity): { directory: string; manifest: string } {
	const key = createHash("sha256")
		.update(`${resolve(identity.project)}\0${identity.session}`)
		.digest("hex");
	const directory = join(
		identity.agentDir,
		"cache",
		"pi-codex-conversion",
		"notebook-mode",
		"sessions",
		key,
	);
	return { directory, manifest: join(directory, "checkpoint.json") };
}

function sessionFamily(session: string): string {
	const separator = session.indexOf("\0");
	return separator === -1 ? session : session.slice(0, separator);
}

function readManifest(path: string): CheckpointManifest | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value) || value["schema"] !== CHECKPOINT_SCHEMA) return undefined;
		if (
			typeof value["project"] !== "string"
			|| typeof value["session"] !== "string"
			|| typeof value["deno"] !== "string"
			|| typeof value["v8"] !== "string"
			|| typeof value["payload"] !== "string"
				|| typeof value["createdAt"] !== "string"
			|| !Array.isArray(value["entries"])
			|| !Array.isArray(value["skipped"])
			|| !PAYLOAD_NAME.test(value["payload"])
			|| basename(value["payload"]) !== value["payload"]
		) return undefined;
		const entries = value["entries"].map(parseEntry);
		const skipped = value["skipped"].map(parseSkipped);
		if (entries.some((entry) => !entry) || skipped.some((entry) => !entry)) return undefined;
		return {
			schema: CHECKPOINT_SCHEMA,
			project: value["project"],
			session: value["session"],
			deno: value["deno"],
			v8: value["v8"],
			payload: value["payload"],
			createdAt: value["createdAt"],
			entries: entries as CheckpointEntry[],
			skipped: skipped as Array<{ name: string; reason: string }>,
		};
	} catch {
		return undefined;
	}
}

function isValidCheckpointPayload(manifest: CheckpointManifest, path: string, maxBytes: number): boolean {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) return false;
		let offset = 0;
		const names = new Set<string>();
		for (const entry of manifest.entries) {
			if (names.has(entry.name) || entry.offset !== offset) return false;
			names.add(entry.name);
			offset += entry.length;
		}
		return offset === stat.size;
	} catch {
		return false;
	}
}

function parseEntry(value: unknown): CheckpointEntry | undefined {
	if (!isRecord(value)) return undefined;
	const { name, offset, length } = value;
	return typeof name === "string" && IDENTIFIER.test(name)
		&& Number.isSafeInteger(offset) && (offset as number) >= 0
		&& Number.isSafeInteger(length) && (length as number) >= 0
		? { name, offset: offset as number, length: length as number }
		: undefined;
}

function parseSkipped(value: unknown): { name: string; reason: string } | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value["name"] === "string" && typeof value["reason"] === "string"
		? { name: value["name"], reason: value["reason"] }
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
