import { NAVIGATION_TIMEOUT_MS, sleep } from "../discovery.js";
import { evaluate, evaluateText } from "../evaluate.js";
import type { CdpConnection, ElementRefs } from "../types.js";
import { asRecord } from "../types.js";
import { clickSelector } from "./click.js";
import { requireElementRef, withBackendObject } from "./element.js";

export async function html(
	cdp: CdpConnection,
	sessionId: string,
	selector?: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!selector) {
		return evaluateText(
			cdp,
			sessionId,
			"document.documentElement.outerHTML",
			signal,
		);
	}
	const value = asRecord(
		await evaluate(
			cdp,
			sessionId,
			`(() => {
				const element = document.querySelector(${JSON.stringify(selector)});
				return element
					? { ok: true, html: element.outerHTML }
					: { ok: false };
			})()`,
			signal,
		),
		"HTML result",
	);
	if (value["ok"] !== true || typeof value["html"] !== "string") {
		throw new Error(`Element not found: ${selector}`);
	}
	return value["html"];
}

export async function htmlRef(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	id: number | string,
	signal?: AbortSignal,
): Promise<string> {
	const ref = requireElementRef(elementRefs, id);
	const response = await withBackendObject(
		cdp,
		sessionId,
		ref.backendNodeId,
		(objectId) =>
			cdp.send(
				"Runtime.callFunctionOn",
				{
					objectId,
					functionDeclaration: "function() { return this.outerHTML; }",
					returnByValue: true,
				},
				sessionId,
				signal,
			),
		signal,
	);
	const record = asRecord(response, "HTML element response");
	const result = asRecord(record["result"], "HTML element result");
	return typeof result["value"] === "string" ? result["value"] : "";
}

async function waitForDocumentReady(
	cdp: CdpConnection,
	sessionId: string,
	timeout = NAVIGATION_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<void> {
	const deadline = Date.now() + timeout;
	let lastState = "";
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			lastState = await evaluateText(
				cdp,
				sessionId,
				"document.readyState",
				signal,
			);
			if (lastState === "complete") return;
		} catch (error) {
			lastError = error;
		}
		await sleep(200, signal);
	}
	if (lastState) {
		throw new Error(
			`Timed out waiting for navigation to finish (last readyState: ${lastState})`,
		);
	}
	if (lastError instanceof Error) {
		throw new Error(
			`Timed out waiting for navigation to finish (${lastError.message})`,
		);
	}
	throw new Error("Timed out waiting for navigation to finish");
}

export async function navigate(
	cdp: CdpConnection,
	sessionId: string,
	url: string,
	signal?: AbortSignal,
): Promise<string> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Only http/https URLs allowed, got: ${url}`);
	}
	await cdp.send("Page.enable", {}, sessionId, signal);
	const loadEvent = cdp.waitForEvent(
		"Page.loadEventFired",
		NAVIGATION_TIMEOUT_MS,
		signal,
	);
	const response = asRecord(
		await cdp.send("Page.navigate", { url }, sessionId, signal),
		"Page.navigate response",
	);
	if (typeof response["errorText"] === "string") {
		loadEvent.cancel();
		throw new Error(response["errorText"]);
	}
	if (response["loaderId"]) await loadEvent.promise;
	else loadEvent.cancel();
	await waitForDocumentReady(cdp, sessionId, 5_000, signal);
	return `Navigated to ${url}`;
}

export async function networkEntries(
	cdp: CdpConnection,
	sessionId: string,
	signal?: AbortSignal,
): Promise<string> {
	const value = await evaluate(
		cdp,
		sessionId,
		`performance.getEntriesByType('resource').map(e => ({
			name: e.name.substring(0, 120),
			type: e.initiatorType,
			duration: Math.round(e.duration),
			size: e.transferSize
		}))`,
		signal,
	);
	if (!Array.isArray(value)) {
		throw new Error("Browser resource timing is not an array");
	}
	return value
		.map((entry) => {
			const record = asRecord(entry, "resource timing entry");
			const duration =
				typeof record["duration"] === "number" ? record["duration"] : 0;
			const size =
				typeof record["size"] === "number" ? String(record["size"]) : "?";
			const type = typeof record["type"] === "string" ? record["type"] : "";
			const name = typeof record["name"] === "string" ? record["name"] : "";
			return `${String(duration).padStart(5)}ms  ${size.padStart(8)}B  ${type.padEnd(8)}  ${name}`;
		})
		.join("\n");
}

export async function loadAll(
	cdp: CdpConnection,
	sessionId: string,
	selector: string,
	intervalMs = 1_500,
	signal?: AbortSignal,
): Promise<string> {
	if (!selector) throw new Error("CSS selector required");
	let clicks = 0;
	const deadline = Date.now() + 5 * 60 * 1_000;
	while (Date.now() < deadline) {
		const exists = await evaluate(
			cdp,
			sessionId,
			`!!document.querySelector(${JSON.stringify(selector)})`,
			signal,
		);
		if (exists !== true) {
			return `Clicked "${selector}" ${clicks} time(s) until it disappeared`;
		}
		await clickSelector(cdp, sessionId, selector, signal);
		clicks++;
		await sleep(intervalMs, signal);
	}
	return `Clicked "${selector}" ${clicks} time(s); stopped at the five-minute deadline while it was still present`;
}

export async function rawCommand(
	cdp: CdpConnection,
	sessionId: string,
	method: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	if (!method) {
		throw new Error('CDP method required, for example "DOM.getDocument"');
	}
	const result = await cdp.send(method, params, sessionId, signal);
	return JSON.stringify(result, null, 2);
}
