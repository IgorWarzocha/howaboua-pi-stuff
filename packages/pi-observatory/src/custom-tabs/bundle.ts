import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";

export type TabFilter = "session" | "project" | "since" | "until";

interface TabManifest {
	apiVersion: 1;
	id: string;
	title: string;
	entry: string;
	collector: string[];
	query?: string[];
	intervalSeconds: number;
	timeoutSeconds: number;
	filters: TabFilter[];
}

export interface TabBundle {
	root: string;
	webRoot: string;
	manifest: TabManifest;
}

const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
};

export function isWithin(root: string, path: string): boolean {
	const child = relative(root, path);
	return (
		child !== "" &&
		child !== ".." &&
		!child.startsWith(`..${sep}`) &&
		!isAbsolute(child)
	);
}

function safeRelative(path: string): boolean {
	return (
		path.length > 0 &&
		!isAbsolute(path) &&
		!/[\\\0]/.test(path) &&
		path
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== "..")
	);
}

// Read through a handle with a hard cap, including files that grow after stat.
export async function readBounded(
	path: string,
	limit: number,
): Promise<Buffer> {
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
	);
	try {
		const info = await file.stat();
		if (!info.isFile()) throw new Error("Expected a regular file");
		if (info.size > limit) throw new Error(`File exceeds ${limit} bytes`);
		const chunks: Buffer[] = [];
		let length = 0;
		for await (const chunk of file.createReadStream({ autoClose: false })) {
			length += chunk.length;
			if (length > limit) throw new Error(`File exceeds ${limit} bytes`);
			chunks.push(chunk);
		}
		return Buffer.concat(chunks, length);
	} finally {
		await file.close();
	}
}

function parseManifest(value: unknown): TabManifest {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("tab.json must contain an object");
	const raw: Record<string, unknown> = value as Record<string, unknown>;
	if (raw["apiVersion"] !== 1) throw new Error("tab.json apiVersion must be 1");
	const id = raw["id"];
	if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
		throw new Error("tab.json id must be a lowercase slug of 1–64 characters");
	const title = raw["title"];
	if (typeof title !== "string" || !title.trim() || title.length > 80)
		throw new Error("tab.json title must contain 1–80 characters");
	const entry = raw["entry"] === undefined ? "index.html" : raw["entry"];
	if (typeof entry !== "string" || !safeRelative(entry))
		throw new Error("tab.json entry must be a relative file path inside web/");
	const command = (key: "collector" | "query"): string[] => {
		const argv = raw[key];
		if (
			!Array.isArray(argv) ||
			!argv.length ||
			!argv.every(
				(arg) =>
					typeof arg === "string" && arg.length > 0 && !arg.includes("\0"),
			)
		)
			throw new Error(`tab.json ${key} must be a nonempty argument array`);
		return argv;
	};
	const collector = command("collector");
	const query = raw["query"] === undefined ? undefined : command("query");
	const seconds = (key: string, fallback: number, min: number, max: number) => {
		const result = raw[key] === undefined ? fallback : raw[key];
		if (
			typeof result !== "number" ||
			!Number.isInteger(result) ||
			result < min ||
			result > max
		)
			throw new Error(
				`tab.json ${key} must be an integer from ${min} to ${max}`,
			);
		return result;
	};
	const filters = raw["filters"] === undefined ? [] : raw["filters"];
	const isFilter = (item: unknown): item is TabFilter =>
		item === "session" ||
		item === "project" ||
		item === "since" ||
		item === "until";
	if (
		!Array.isArray(filters) ||
		!filters.every(isFilter) ||
		new Set(filters).size !== filters.length
	)
		throw new Error(
			"tab.json filters must be unique session, project, since or until values",
		);
	return {
		apiVersion: 1,
		id,
		title: title.trim(),
		entry,
		collector,
		...(query ? { query } : {}),
		intervalSeconds: seconds("intervalSeconds", 60, 5, 86400),
		timeoutSeconds: seconds("timeoutSeconds", 30, 1, 300),
		filters,
	};
}

export async function loadBundle(path: string): Promise<TabBundle> {
	if (!isAbsolute(path) || path.includes("\0"))
		throw new Error("Bundle path must be absolute");
	const root = await realpath(path);
	const manifest = parseManifest(
		JSON.parse(
			(await readBounded(join(root, "tab.json"), 64 * 1024)).toString("utf8"),
		),
	);
	const webRoot = await realpath(join(root, "web"));
	if (!isWithin(root, webRoot) || !(await stat(webRoot)).isDirectory())
		throw new Error("Bundle web/ must be a directory inside the bundle");
	const bundle = { root, webRoot, manifest };
	if (!(await readAsset(bundle, manifest.entry)))
		throw new Error(
			"tab.json entry must be a readable file inside web/ (at most 16 MiB)",
		);
	return bundle;
}

export async function readAsset(
	bundle: TabBundle,
	path: string,
): Promise<{ data: Buffer; type: string } | undefined> {
	if (!safeRelative(path)) return undefined;
	try {
		const target = await realpath(join(bundle.webRoot, path));
		if (!isWithin(bundle.webRoot, target)) return undefined;
		return {
			data: await readBounded(target, MAX_ASSET_BYTES),
			type: MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
		};
	} catch {
		return undefined;
	}
}
