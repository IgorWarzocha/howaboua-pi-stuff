import { posix, win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const ANCESTRY_FLAG = "shepherdr-ancestry";
const ANCESTRY_ENTRY = "herdr-spawn-ancestry-v1";

export interface NativeSessionIdentity {
	machine: string;
	sessionId: string;
	sessionFile: string;
}

export interface SpawnAncestry {
	parent: NativeSessionIdentity;
	root: NativeSessionIdentity;
}

function nativeIdentity(value: unknown): NativeSessionIdentity {
	if (
		!value ||
		typeof value !== "object" ||
		!("machine" in value) ||
		typeof value.machine !== "string" ||
		!value.machine.trim() ||
		value.machine === "local" ||
		!("sessionId" in value) ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		/[/\\\u0000]/.test(value.sessionId) ||
		!("sessionFile" in value) ||
		typeof value.sessionFile !== "string" ||
		!(
			posix.isAbsolute(value.sessionFile) || win32.isAbsolute(value.sessionFile)
		) ||
		value.sessionFile.includes("\u0000")
	)
		throw new Error("Invalid saved parent identity; respawn the worker");
	return {
		machine: value.machine,
		sessionId: value.sessionId,
		sessionFile: value.sessionFile,
	};
}

export function parseSpawnAncestry(value: unknown): SpawnAncestry {
	if (
		!value ||
		typeof value !== "object" ||
		!("parent" in value) ||
		!("root" in value)
	)
		throw new Error("Invalid saved ancestry; respawn the worker");
	return {
		parent: nativeIdentity(value.parent),
		root: nativeIdentity(value.root),
	};
}

export function savedSpawnAncestry(
	ctx: Pick<ExtensionContext, "sessionManager">,
): SpawnAncestry | undefined {
	let ancestry: SpawnAncestry | undefined;
	const sessionId = ctx.sessionManager.getSessionId();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ANCESTRY_ENTRY)
			continue;
		const value = entry.data;
		if (
			!value ||
			typeof value !== "object" ||
			!("sessionId" in value) ||
			value.sessionId !== sessionId
		)
			continue;
		const candidate = parseSpawnAncestry(value);
		if (ancestry && !isDeepStrictEqual(candidate, ancestry))
			throw new Error("Conflicting saved ancestry; use an exact agent target");
		ancestry = candidate;
	}
	return ancestry;
}

export function registerSpawnAncestry(pi: ExtensionAPI): void {
	pi.registerFlag(ANCESTRY_FLAG, {
		type: "string",
		description: "JSON-encoded native worker ancestry",
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		try {
			// Resume never rebinds an existing native identity, even under a new terminal.
			if (savedSpawnAncestry(ctx)) return;
			const encoded = pi.getFlag(ANCESTRY_FLAG);
			if (encoded === undefined) return;
			const ancestry = parseSpawnAncestry(JSON.parse(String(encoded)));
			if (!ctx.sessionManager.getSessionFile())
				throw new Error("Worker ancestry requires a saved Pi session");
			const sessionId = ctx.sessionManager.getSessionId();
			if (
				ancestry.parent.sessionId === sessionId ||
				ancestry.root.sessionId === sessionId
			)
				throw new Error("A worker cannot be its own ancestor");
			// Fresh Notes/Board binding must finish before the first custom entry.
			pi.appendEntry(ANCESTRY_ENTRY, { sessionId, ...ancestry });
		} catch (cause) {
			await ctx.abort();
			throw new Error("Worker ancestry is unavailable; respawn the worker", {
				cause,
			});
		}
	});
}
