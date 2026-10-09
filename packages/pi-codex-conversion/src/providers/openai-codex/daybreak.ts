import { createHash } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import { buildSSEHeaders, extractAccountId, resolveCodexUrl } from "./headers.ts";
import { combineAbortSignals } from "./sse.ts";
import { osInfoReady } from "./node-runtime.ts";
import type { AccessPrograms, OpenAICodexStreamOptions } from "./types.ts";

type Catalog = Map<string, string[]>;
const catalogs = new Map<string, { expires: number; catalog: Catalog | undefined }>();
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

async function discover(url: string, headers: Headers, options: OpenAICodexStreamOptions): Promise<Catalog> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	const combined = combineAbortSignals([options.signal, controller.signal]);
	try {
		const response = await (options.fetch ?? fetch)(url, { headers, signal: combined.signal });
		if (!response.ok || !response.body) throw new Error("Catalog unavailable");
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > MAX_CATALOG_BYTES) throw new Error("Catalog too large");
				chunks.push(value);
			}
		} finally {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!data || typeof data !== "object" || !("models" in data) || !Array.isArray(data.models)) throw new Error("Invalid catalog");
		const catalog: Catalog = new Map();
		for (const entry of data.models) {
			if (!entry || typeof entry !== "object" || typeof entry.slug !== "string") continue;
			const programs: unknown = entry.available_access_programs?.cyber;
			if (Array.isArray(programs) && programs.every((program) => typeof program === "string")) catalog.set(entry.slug, programs);
		}
		return catalog;
	} finally {
		clearTimeout(timeout);
		combined.cleanup();
	}
}

// Discovery uses the same resolved route, credentials and headers as the turn.
// Neither aliases nor model names establish caller eligibility.
export async function resolveDaybreakAccess(
	model: Model<Api>,
	options: OpenAICodexStreamOptions,
	enabled: boolean,
	modelId = model.id,
	originator = "pi",
): Promise<AccessPrograms | undefined> {
	if (options.signal?.aborted) throw new Error("Request was aborted");
	const token = options.apiKey;
	if (!token) throw new Error("No Codex credentials available");
	await osInfoReady;
	const headers = buildSSEHeaders(model.headers, options.headers, extractAccountId(token), token, undefined, false, originator);
	headers.set("accept", "application/json");
	headers.delete("content-type");
	const url = new URL(resolveCodexUrl(model.baseUrl));
	url.pathname = url.pathname.replace(/\/responses$/, "/models");
	url.searchParams.set("client_version", "0.162.0");
	const key = createHash("sha256").update(url.toString()).update(JSON.stringify([...headers].sort())).digest("hex");
	let cached = catalogs.get(key);
	if (!cached || cached.expires <= Date.now()) {
		let catalog: Catalog | undefined;
		try { catalog = await discover(url.toString(), headers, options); }
		catch {
			if (options.signal?.aborted) throw new Error("Request was aborted");
		}
		cached = { catalog, expires: Date.now() + (catalog ? 300_000 : 30_000) };
		catalogs.delete(key);
		if (catalogs.size >= 8) catalogs.delete(catalogs.keys().next().value!);
		catalogs.set(key, cached);
	}
	if (options.signal?.aborted) throw new Error("Request was aborted");
	const programs = cached.catalog?.get(modelId);
	if (enabled) {
		const cyber = programs?.includes("daybreak_blue") ? "daybreak_blue"
			: programs?.includes("daybreak_red") ? "daybreak_red" : undefined;
		if (!cyber) throw new Error(`Daybreak support for model ${modelId} could not be confirmed by the connected server. Turn Daybreak off in /codex OpenAI settings, or choose a compatible model and server.`);
		return { cyber };
	}
	return programs?.includes("standard") ? { cyber: "standard" } : undefined;
}
