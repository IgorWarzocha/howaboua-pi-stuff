import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { asRecord, asString, errorMessage } from "./types.js";

export const CDP_TIMEOUT_MS = 15_000;
export const NAVIGATION_TIMEOUT_MS = 30_000;
const MIN_TARGET_PREFIX_LENGTH = 8;
const IS_WINDOWS = process.platform === "win32";

function getJson(url: string, timeout = 2_000): Promise<unknown> {
	return new Promise((resolveValue, reject) => {
		const request = http.get(url, { timeout }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => {
				body += chunk;
			});
			response.on("end", () => {
				const status = response.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					reject(new Error(`HTTP ${status} from ${url}`));
					return;
				}
				try {
					resolveValue(JSON.parse(body));
				} catch (error) {
					reject(error);
				}
			});
		});
		request.on("timeout", () =>
			request.destroy(new Error(`Timeout fetching ${url}`)),
		);
		request.on("error", reject);
	});
}

export async function probeDebugPort(
	port: string,
	host = process.env["CDP_HOST"] ?? "127.0.0.1",
): Promise<string> {
	const version = asRecord(
		await getJson(`http://${host}:${port}/json/version`),
		"CDP version response",
	);
	return asString(version["webSocketDebuggerUrl"], "CDP webSocketDebuggerUrl");
}

export async function getWebSocketUrl(
	recovery = "Enable remote debugging or set CDP_PORT/CDP_PORT_FILE.",
): Promise<string> {
	const home = homedir();
	const macBrowsers = [
		"Google/Chrome",
		"Google/Chrome Beta",
		"Google/Chrome for Testing",
		"Chromium",
		"BraveSoftware/Brave-Browser",
		"Microsoft Edge",
	];
	const linuxBrowsers = [
		"google-chrome",
		"google-chrome-beta",
		"chromium",
		"vivaldi",
		"vivaldi-snapshot",
		"BraveSoftware/Brave-Browser",
		"microsoft-edge",
	];
	const flatpakBrowsers = [
		["org.chromium.Chromium", "chromium"],
		["com.google.Chrome", "google-chrome"],
		["com.brave.Browser", "BraveSoftware/Brave-Browser"],
		["com.microsoft.Edge", "microsoft-edge"],
		["com.vivaldi.Vivaldi", "vivaldi"],
	] as const;
	const candidates = [
		process.env["CDP_PORT_FILE"],
		...macBrowsers.flatMap((browser) => [
			resolve(
				home,
				"Library/Application Support",
				browser,
				"DevToolsActivePort",
			),
			resolve(
				home,
				"Library/Application Support",
				browser,
				"Default/DevToolsActivePort",
			),
		]),
		...linuxBrowsers.flatMap((browser) => [
			resolve(home, ".config", browser, "DevToolsActivePort"),
			resolve(home, ".config", browser, "Default/DevToolsActivePort"),
		]),
		...flatpakBrowsers.flatMap(([appId, browser]) => [
			resolve(home, ".var/app", appId, "config", browser, "DevToolsActivePort"),
			resolve(
				home,
				".var/app",
				appId,
				"config",
				browser,
				"Default/DevToolsActivePort",
			),
		]),
		...(IS_WINDOWS
			? [
					"Google/Chrome",
					"BraveSoftware/Brave-Browser",
					"Microsoft/Edge",
				].flatMap((browser) => {
					const base =
						process.env["LOCALAPPDATA"] ?? resolve(home, "AppData/Local");
					return [
						resolve(base, browser, "User Data", "DevToolsActivePort"),
						resolve(base, browser, "User Data", "Default/DevToolsActivePort"),
					];
				})
			: []),
	].filter((candidate): candidate is string => Boolean(candidate));
	const host = process.env["CDP_HOST"] ?? "127.0.0.1";
	const port = process.env["CDP_PORT"] ?? "9222";
	try {
		return await probeDebugPort(port, host);
	} catch (error) {
		const portFile = candidates.find((candidate) => existsSync(candidate));
		if (portFile) {
			const lines = readFileSync(portFile, "utf8").trim().split("\n");
			if (!lines[0] || !lines[1]) {
				throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
			}
			return `ws://${host}:${lines[0]}${lines[1]}`;
		}
		throw new Error(
			`CDP HTTP discovery failed and no DevToolsActivePort found. ${recovery} Tried: ${host}:${port} ${errorMessage(error)}`,
		);
	}
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(signal.reason ?? new Error("Operation aborted"));
	}
	return new Promise((resolveValue, reject) => {
		const cleanup = () => signal?.removeEventListener("abort", abort);
		const timer = setTimeout(() => {
			cleanup();
			resolveValue();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			cleanup();
			reject(signal?.reason ?? new Error("Operation aborted"));
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}

export function resolvePrefix(
	prefix: string,
	candidates: string[],
	noun = "target",
	missingHint = "",
): string {
	const upper = prefix.toUpperCase();
	const matches = candidates.filter((candidate) =>
		candidate.toUpperCase().startsWith(upper),
	);
	if (matches.length === 0) {
		throw new Error(
			`No ${noun} matching prefix "${prefix}".${missingHint ? ` ${missingHint}` : ""}`,
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`Ambiguous prefix "${prefix}" matches ${matches.length} ${noun}s. Use more characters.`,
		);
	}
	const match = matches[0];
	if (!match) throw new Error(`No ${noun} matching prefix "${prefix}".`);
	return match;
}

export function getDisplayPrefixLength(targetIds: string[]): number {
	if (targetIds.length === 0) return MIN_TARGET_PREFIX_LENGTH;
	const maxLength = Math.max(...targetIds.map((id) => id.length));
	for (let length = MIN_TARGET_PREFIX_LENGTH; length <= maxLength; length++) {
		const prefixes = new Set(
			targetIds.map((id) => id.slice(0, length).toUpperCase()),
		);
		if (prefixes.size === targetIds.length) return length;
	}
	return maxLength;
}
