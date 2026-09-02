import { sleep } from "../discovery.js";
import { positiveInteger } from "../snapshot-contract.js";
import type { CdpConnection, ElementRefs } from "../types.js";
import { asRecord } from "../types.js";

export interface ElementPoint {
	x: number;
	y: number;
	tag: string;
	text: string;
}

export interface ScreenshotClip {
	x: number;
	y: number;
	width: number;
	height: number;
	scale: number;
}

export function requireElementRef(
	elementRefs: ElementRefs,
	id: number | string,
): { id: number; backendNodeId: number } {
	const parsed = positiveInteger(id, "element id");
	const backendNodeId = elementRefs.get(parsed);
	if (!backendNodeId) {
		throw new Error(
			`Unknown element id ${id}; run open again and use a current element id`,
		);
	}
	return { id: parsed, backendNodeId };
}

async function resolveBackendObject(
	cdp: CdpConnection,
	sessionId: string,
	backendNodeId: number,
	signal?: AbortSignal,
): Promise<string> {
	const response = asRecord(
		await cdp.send("DOM.resolveNode", { backendNodeId }, sessionId, signal),
		"DOM.resolveNode response",
	);
	const object = asRecord(response["object"], "resolved DOM object");
	if (typeof object["objectId"] !== "string") {
		throw new Error("Element is no longer available; run open again");
	}
	return object["objectId"];
}

export async function withBackendObject<T>(
	cdp: CdpConnection,
	sessionId: string,
	backendNodeId: number,
	action: (objectId: string) => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const objectId = await resolveBackendObject(
		cdp,
		sessionId,
		backendNodeId,
		signal,
	);
	try {
		return await action(objectId);
	} finally {
		await cdp
			.send("Runtime.releaseObject", { objectId }, sessionId, undefined)
			.catch(() => undefined);
	}
}

export async function scrollBackendIntoView(
	cdp: CdpConnection,
	sessionId: string,
	backendNodeId: number,
	signal?: AbortSignal,
): Promise<void> {
	await withBackendObject(
		cdp,
		sessionId,
		backendNodeId,
		(objectId) =>
			cdp.send(
				"Runtime.callFunctionOn",
				{
					objectId,
					functionDeclaration:
						'function() { this.scrollIntoView({block: "center", inline: "center"}); }',
				},
				sessionId,
				signal,
			),
		signal,
	);
	await sleep(50, signal);
}

export async function backendCenter(
	cdp: CdpConnection,
	sessionId: string,
	backendNodeId: number,
	scroll = true,
	signal?: AbortSignal,
): Promise<ElementPoint> {
	if (scroll) {
		await scrollBackendIntoView(cdp, sessionId, backendNodeId, signal);
	}
	const response = await withBackendObject(
		cdp,
		sessionId,
		backendNodeId,
		(objectId) =>
			cdp.send(
				"Runtime.callFunctionOn",
				{
					objectId,
					functionDeclaration: `function() {
						const rect = this.getBoundingClientRect();
						const style = getComputedStyle(this);
						const disabled = this.matches(':disabled') ||
							this.getAttribute('aria-disabled') === 'true';
						const hidden = rect.width <= 0 || rect.height <= 0 ||
							style.display === 'none' || style.visibility === 'hidden' ||
							style.visibility === 'collapse' || style.pointerEvents === 'none' ||
							Number(style.opacity) === 0 || this.closest('[inert]') !== null;
						if (hidden) return { ok: false, error: 'Element is not visible or interactable' };
						if (disabled) return { ok: false, error: 'Element is disabled' };
						const x = rect.left + rect.width / 2;
						const y = rect.top + rect.height / 2;
						const root = this.getRootNode();
						const hit = root && typeof root.elementFromPoint === 'function'
							? root.elementFromPoint(x, y)
							: this.ownerDocument.elementFromPoint(x, y);
						if (!hit || (hit !== this && !this.contains(hit))) {
							const blocker = hit ? '<' + hit.tagName.toLowerCase() + '>' : 'no element';
							return { ok: false, error: 'Element center is covered by ' + blocker };
						}
						return {
							ok: true,
							x,
							y,
							tag: this.tagName,
							text: (this.textContent || '').trim().substring(0, 80)
						};
					}`,
					returnByValue: true,
				},
				sessionId,
				signal,
			),
		signal,
	);
	const result = asRecord(response, "element center response");
	const point = asRecord(
		asRecord(result["result"], "element center result")["value"],
		"element center",
	);
	if (point["ok"] !== true) {
		throw new Error(
			typeof point["error"] === "string"
				? point["error"]
				: "Element has no clickable box",
		);
	}
	if (typeof point["x"] !== "number" || typeof point["y"] !== "number") {
		throw new Error("Element center has invalid coordinates");
	}
	return {
		x: point["x"],
		y: point["y"],
		tag: typeof point["tag"] === "string" ? point["tag"] : "ELEMENT",
		text: typeof point["text"] === "string" ? point["text"] : "",
	};
}

export async function visibleElementClip(
	cdp: CdpConnection,
	sessionId: string,
	quad: number[],
	padding = 10,
	signal?: AbortSignal,
): Promise<ScreenshotClip> {
	const response = asRecord(
		await cdp.send("Page.getLayoutMetrics", {}, sessionId, signal),
		"layout metrics",
	);
	const viewportValue =
		response["cssVisualViewport"] ??
		response["visualViewport"] ??
		response["cssLayoutViewport"] ??
		response["layoutViewport"];
	const viewport = asRecord(viewportValue, "layout viewport");
	if (
		typeof viewport["clientWidth"] !== "number" ||
		typeof viewport["clientHeight"] !== "number" ||
		viewport["clientWidth"] <= 0 ||
		viewport["clientHeight"] <= 0
	) {
		throw new Error("Could not determine a bounded screenshot viewport");
	}
	const pageX = typeof viewport["pageX"] === "number" ? viewport["pageX"] : 0;
	const pageY = typeof viewport["pageY"] === "number" ? viewport["pageY"] : 0;
	const xs = [quad[0], quad[2], quad[4], quad[6]].filter(
		(value): value is number => typeof value === "number",
	);
	const ys = [quad[1], quad[3], quad[5], quad[7]].filter(
		(value): value is number => typeof value === "number",
	);
	if (xs.length !== 4 || ys.length !== 4) {
		throw new Error("Element has an invalid screenshot box");
	}
	const x = Math.max(pageX, Math.min(...xs) - padding);
	const y = Math.max(pageY, Math.min(...ys) - padding);
	const right = Math.min(
		pageX + viewport["clientWidth"],
		Math.max(...xs) + padding,
	);
	const bottom = Math.min(
		pageY + viewport["clientHeight"],
		Math.max(...ys) + padding,
	);
	if (right <= x || bottom <= y) {
		throw new Error("Element has no visible screenshot box");
	}
	return {
		x,
		y,
		width: right - x,
		height: bottom - y,
		scale: 1,
	};
}
