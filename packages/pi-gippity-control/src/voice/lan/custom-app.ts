import { existsSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface LanRemoteStaticAsset {
	contentType: string;
	path: string;
}

export interface LanRemoteCustomApp {
	root: string;
	asset(path: string): LanRemoteStaticAsset | undefined;
}

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export function resolveLanRemoteCustomApp(
	configuredPath: string,
	cwd: string,
): LanRemoteCustomApp | undefined {
	const candidate = isAbsolute(configuredPath)
		? configuredPath
		: resolve(cwd, configuredPath);
	let root: string;
	try {
		if (!existsSync(candidate) || !statSync(candidate).isDirectory())
			return undefined;
		root = realpathSync(candidate);
		const index = join(root, "index.html");
		if (!existsSync(index) || !statSync(index).isFile()) return undefined;
	} catch {
		return undefined;
	}
	return {
		root,
		asset(path) {
			let decoded: string;
			try {
				decoded = decodeURIComponent(path);
			} catch {
				return undefined;
			}
			const requested =
				decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
			const candidate = join(root, requested);
			if (!existsSync(candidate) || !statSync(candidate).isFile())
				return undefined;
			const real = realpathSync(candidate);
			const child = relative(root, real);
			if (
				!child ||
				child === ".." ||
				child.startsWith(`..${sep}`) ||
				isAbsolute(child)
			)
				return undefined;
			return {
				path: real,
				contentType:
					CONTENT_TYPES[extname(real).toLowerCase()] ??
					"application/octet-stream",
			};
		},
	};
}
