// @ts-check
import { element } from "./view-dom.js";

/** @param {string} path @param {AbortSignal} [signal] */
export async function api(path, signal) {
	const response = await fetch(path, {
		signal: signal ?? null,
	});
	if (!response.ok)
		throw new Error(
			`Request failed (${response.status}). Retry or check the local server.`,
		);
	return response.json();
}
/** @param {unknown} error */
export function report(error) {
	if (error instanceof DOMException && error.name === "AbortError") return;
	element("error").textContent =
		error instanceof Error ? error.message : String(error);
	element("error").hidden = false;
}
