const dynamicImport = (specifier: string) => import(specifier);

let fsPromisesPromise: Promise<typeof import("node:fs/promises")> | undefined;

export async function getNodeFsPromises(): Promise<typeof import("node:fs/promises")> {
	if (!fsPromisesPromise) {
		fsPromisesPromise = dynamicImport("node:fs/promises") as Promise<typeof import("node:fs/promises")>;
	}
	return fsPromisesPromise;
}

export function getNodeFsSync(): { readFileSync(path: string): Buffer } | null {
	if (typeof process === "undefined" || !(process.versions?.node || process.versions["bun"]!)) {
		return null;
	}
	const builtinProcess = process as typeof process & { getBuiltinModule?: (specifier: string) => unknown | undefined };
	if (typeof builtinProcess.getBuiltinModule !== "function") {
		return null;
	}
	try {
		const module = builtinProcess.getBuiltinModule("node:fs") as { readFileSync?: unknown } | undefined;
		if (typeof module?.readFileSync !== "function") return null;
		return { readFileSync: module.readFileSync as (path: string) => Buffer };
	} catch {
		return null;
	}
}

export const osInfo: { current: { platform(): string; release(): string; arch(): string } | null } = { current: null };

if (typeof process !== "undefined" && (process.versions?.node || process.versions["bun"]!)) {
	dynamicImport("node:os")
		.then((module) => {
			osInfo.current = module;
		})
		.catch(() => {
			osInfo.current = null;
		});
}
