import {
	mkdir,
	open,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RESULT_TTL_MS = 60 * 60 * 1_000;
const SCREENSHOT_TTL_MS = 24 * 60 * 60 * 1_000;
const TEXT_BUDGET_BYTES = 32_000;
// At least one byte per UTF-16 unit, plus one unit of surrogate lookahead.
const RESULT_READ_BYTES = 2 * (TEXT_BUDGET_BYTES - 2 + 1);

export function artifactDirectory(): string {
	return process.env["XDG_RUNTIME_DIR"]
		? join(process.env["XDG_RUNTIME_DIR"], "browser-tool")
		: join(tmpdir(), `browser-tool-${process.getuid?.() ?? "user"}`);
}

function resultPath(handle: string, legacy = false): string {
	return join(
		artifactDirectory(),
		`result-${handle}.${legacy ? "txt" : "utf16le"}`,
	);
}

export async function screenshotPath(request: {
	ref_id: string;
	id?: number | undefined;
	selector?: string | undefined;
}): Promise<string> {
	await mkdir(artifactDirectory(), {
		recursive: true,
		mode: 0o700,
	});
	const suffix =
		request.id !== undefined
			? `-element-${request.id}`
			: request.selector
				? "-element"
				: "";
	const safeRef = request.ref_id.slice(0, 12).replace(/[^A-Za-z0-9_-]/g, "_");
	return join(
		artifactDirectory(),
		`browser-${safeRef}${suffix}-${crypto.randomUUID()}.png`,
	);
}

export async function pruneArtifacts(now = Date.now()): Promise<number> {
	let names: string[];
	try {
		names = await readdir(artifactDirectory());
	} catch (error) {
		if (isMissing(error)) return 0;
		throw error;
	}
	let removed = 0;
	for (const name of names.filter((candidate) =>
		/^(?:result-[a-f0-9-]{36}\.(?:txt|utf16le)|browser-.*\.png)$/.test(
			candidate,
		),
	)) {
		const path = join(artifactDirectory(), name);
		try {
			const maxAge = name.startsWith("result-")
				? RESULT_TTL_MS
				: SCREENSHOT_TTL_MS;
			if (now - (await stat(path)).mtimeMs > maxAge) {
				await rm(path, { force: true });
				removed++;
			}
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
	}
	return removed;
}

function chunkForJson(
	value: string,
	offset = 0,
): { text: string; end: number } {
	let bytes = 2;
	let end = offset;
	while (end < value.length) {
		const point = value.codePointAt(end)!;
		const next = jsonCharacterBytes(point);
		if (bytes + next > TEXT_BUDGET_BYTES) break;
		bytes += next;
		end += point > 0xffff ? 2 : 1;
	}
	return { text: value.slice(offset, end), end };
}

function jsonCharacterBytes(point: number): number {
	if (point < 0x20) {
		return point === 8 ||
			point === 9 ||
			point === 10 ||
			point === 12 ||
			point === 13
			? 2
			: 6;
	}
	if (point === 0x22 || point === 0x5c) return 2;
	if (point < 0x80) return 1;
	if (point < 0x800) return 2;
	if (point >= 0xd800 && point <= 0xdfff) return 6;
	return point <= 0xffff ? 3 : 4;
}

async function cacheResult(value: string): Promise<string> {
	const handle = crypto.randomUUID();
	await mkdir(artifactDirectory(), {
		recursive: true,
		mode: 0o700,
	});
	// Fixed-width code units allow seeks at every accepted JS string offset.
	await writeFile(resultPath(handle), value, {
		encoding: "utf16le",
		mode: 0o600,
	});
	return handle;
}

export async function limitedText(
	base: Record<string, unknown>,
	field: string,
	value: string,
): Promise<Record<string, unknown>> {
	const chunk = chunkForJson(value);
	if (chunk.end >= value.length) return { ...base, [field]: value };
	const handle = await cacheResult(value);
	return {
		...base,
		[field]: chunk.text,
		truncated: true,
		omitted_chars: value.length - chunk.end,
		result_handle: handle,
		next_offset: chunk.end,
	};
}

function checkOffset(offset: number, length: number): void {
	if (offset > length) {
		throw new Error(`offset ${offset} exceeds result length ${length}`);
	}
}

async function readResultPage(path: string, offset: number) {
	const file = await open(path, "r");
	try {
		const { size } = await file.stat();
		if (size % 2)
			throw new Error("Cached result is incomplete; rerun the original action");
		const length = size / 2;
		checkOffset(offset, length);
		const position = offset * 2;
		const bytes = Buffer.allocUnsafe(
			Math.min(size - position, RESULT_READ_BYTES),
		);
		let used = 0;
		while (used < bytes.length) {
			const { bytesRead } = await file.read(
				bytes,
				used,
				bytes.length - used,
				position + used,
			);
			if (!bytesRead)
				throw new Error(
					"Cached result is incomplete; rerun the original action",
				);
			used += bytesRead;
		}
		const chunk = chunkForJson(bytes.toString("utf16le"));
		return { text: chunk.text, end: offset + chunk.end, length };
	} finally {
		await file.close();
	}
}

function isMissing(error: unknown): boolean {
	return (
		!!error &&
		typeof error === "object" &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

export async function readCachedResult(request: {
	handle: string;
	offset: number;
}): Promise<Record<string, unknown>> {
	const { handle, offset } = request;
	let path = resultPath(handle);
	let page;
	try {
		page = await readResultPage(path, offset);
	} catch (error) {
		if (!isMissing(error)) throw error;
		// Let handles issued by the previous worker finish during their short TTL.
		path = resultPath(handle, true);
		let value: string;
		try {
			value = await readFile(path, "utf8");
		} catch (legacyError) {
			if (!isMissing(legacyError)) throw legacyError;
			throw new Error(
				`result handle not found: ${handle}; check the host or rerun the original action`,
			);
		}
		checkOffset(offset, value.length);
		page = { ...chunkForJson(value, offset), length: value.length };
	}
	const complete = page.end >= page.length;
	if (complete) {
		await rm(path, { force: true });
	}
	return {
		handle,
		offset,
		text: page.text,
		complete,
		...(complete ? {} : { next_offset: page.end }),
	};
}

export async function discardCachedResult(
	handle: string,
): Promise<Record<string, unknown>> {
	await Promise.all(
		[resultPath(handle), resultPath(handle, true)].map((path) =>
			rm(path, { force: true }),
		),
	);
	return { discarded: handle };
}
