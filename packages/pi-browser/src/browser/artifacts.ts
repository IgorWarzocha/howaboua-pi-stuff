import {
	mkdir,
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

export function artifactDirectory(): string {
	return process.env["XDG_RUNTIME_DIR"]
		? join(process.env["XDG_RUNTIME_DIR"], "browser-tool")
		: join(tmpdir(), `browser-tool-${process.getuid?.() ?? "user"}`);
}

function resultPath(handle: string): string {
	return join(artifactDirectory(), `result-${handle}.txt`);
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
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return 0;
		}
		throw error;
	}
	let removed = 0;
	for (const name of names.filter((candidate) =>
		/^(?:result-[a-f0-9-]{36}\.txt|browser-.*\.png)$/.test(candidate),
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
			if (
				!error ||
				typeof error !== "object" ||
				!("code" in error) ||
				error.code !== "ENOENT"
			) {
				throw error;
			}
		}
	}
	return removed;
}

function chunkForJson(
	value: string,
	offset = 0,
	budget = TEXT_BUDGET_BYTES,
): { text: string; end: number } {
	let bytes = 2;
	let end = offset;
	for (const character of value.slice(offset)) {
		const next = Buffer.byteLength(JSON.stringify(character)) - 2;
		if (bytes + next > budget) break;
		bytes += next;
		end += character.length;
	}
	return { text: value.slice(offset, end), end };
}

async function cacheResult(value: string): Promise<string> {
	const handle = crypto.randomUUID();
	await mkdir(artifactDirectory(), {
		recursive: true,
		mode: 0o700,
	});
	await writeFile(resultPath(handle), value, { mode: 0o600 });
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

export async function readCachedResult(request: {
	handle: string;
	offset: number;
}): Promise<Record<string, unknown>> {
	let value: string;
	try {
		value = await readFile(resultPath(request.handle), "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			throw new Error(
				`result handle not found: ${request.handle}; check the host or rerun the original action`,
			);
		}
		throw error;
	}
	if (request.offset > value.length) {
		throw new Error(
			`offset ${request.offset} exceeds result length ${value.length}`,
		);
	}
	const chunk = chunkForJson(value, request.offset);
	const complete = chunk.end >= value.length;
	if (complete) {
		await rm(resultPath(request.handle), { force: true });
	}
	return {
		handle: request.handle,
		offset: request.offset,
		text: chunk.text,
		complete,
		...(complete ? {} : { next_offset: chunk.end }),
	};
}

export async function discardCachedResult(
	handle: string,
): Promise<Record<string, unknown>> {
	await rm(resultPath(handle), { force: true });
	return { discarded: handle };
}
