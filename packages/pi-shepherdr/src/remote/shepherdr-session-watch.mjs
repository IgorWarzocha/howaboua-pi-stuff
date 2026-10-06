// @howaboua/pi-shepherdr managed bridge
import { watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * Watch only named sessions' directories, including file replacement.
 * @param {string[]} paths
 * @param {(path: string) => void} onChange
 * @param {(error: Error) => void} onError
 * @param {AbortSignal} [signal]
 */
export function watchSessions(paths, onChange, onError, signal) {
	/** @type {import('node:fs').FSWatcher[]} */
	const watchers = [];
	/** @type {Map<string, NodeJS.Timeout>} */
	const timers = new Map();
	/** @type {Map<string, Map<string, string>>} */
	const directories = new Map();
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		signal?.removeEventListener("abort", close);
		for (const watcher of watchers) watcher.close();
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
	};
	try {
		for (const path of new Set(paths)) {
			const expanded =
				path === "~"
					? homedir()
					: path.startsWith("~/")
						? join(homedir(), path.slice(2))
						: path;
			const directory = dirname(expanded);
			const files = directories.get(directory) ?? new Map();
			files.set(basename(expanded), path);
			directories.set(directory, files);
		}
		for (const [directory, files] of directories) {
			const watcher = watch(
				directory,
				{ persistent: false },
				(_event, filename) => {
					for (const [name, path] of files) {
						if (filename !== null && filename.toString() !== name) continue;
						if (timers.has(path) || closed) continue;
						const timer = setTimeout(() => {
							timers.delete(path);
							if (!closed) onChange(path);
						}, 25);
						timer.unref();
						timers.set(path, timer);
					}
				},
			);
			watcher.on("error", (error) => {
				close();
				onError(error);
			});
			watchers.push(watcher);
		}
		signal?.addEventListener("abort", close, { once: true });
		if (signal?.aborted) close();
		return close;
	} catch (error) {
		close();
		throw error;
	}
}
