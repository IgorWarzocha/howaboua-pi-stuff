import { writeFileSync } from "node:fs";
import { evaluate } from "../evaluate.js";
import type { CdpConnection, ElementRefs } from "../types.js";
import { asRecord, asString } from "../types.js";
import {
	requireElementRef,
	type ScreenshotClip,
	scrollBackendIntoView,
	visibleElementClip,
} from "./element.js";

export interface ScreenshotCapture {
	file: string;
	dpr: number;
	width?: number | undefined;
	height?: number | undefined;
}

async function devicePixelRatio(
	cdp: CdpConnection,
	sessionId: string,
	signal?: AbortSignal,
): Promise<number> {
	try {
		const value = await evaluate(
			cdp,
			sessionId,
			"window.devicePixelRatio",
			signal,
		);
		if (typeof value === "number" && value > 0) return value;
	} catch {
		// A screenshot still works with the conservative default.
	}
	return 1;
}

async function capture(
	cdp: CdpConnection,
	sessionId: string,
	file: string,
	clip: ScreenshotClip | undefined,
	signal?: AbortSignal,
): Promise<ScreenshotCapture> {
	const response = asRecord(
		await cdp.send(
			"Page.captureScreenshot",
			{
				format: "png",
				...(clip ? { clip, captureBeyondViewport: false } : {}),
			},
			sessionId,
			signal,
		),
		"screenshot response",
	);
	const data = asString(response["data"], "screenshot data");
	writeFileSync(file, Buffer.from(data, "base64"));
	return {
		file,
		dpr: await devicePixelRatio(cdp, sessionId, signal),
		...(clip ? { width: clip.width, height: clip.height } : {}),
	};
}

export function captureViewport(
	cdp: CdpConnection,
	sessionId: string,
	file: string,
	signal?: AbortSignal,
): Promise<ScreenshotCapture> {
	return capture(cdp, sessionId, file, undefined, signal);
}

export async function captureSelector(
	cdp: CdpConnection,
	sessionId: string,
	selector: string,
	file: string,
	signal?: AbortSignal,
): Promise<ScreenshotCapture> {
	if (!selector) throw new Error("CSS selector required");
	const value = asRecord(
		await evaluate(
			cdp,
			sessionId,
			`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return {
					ok: false,
					error: 'Element not found: ' + ${JSON.stringify(selector)}
				};
				el.scrollIntoView({ block: 'center', inline: 'center' });
				const r = el.getBoundingClientRect();
				const padding = 10;
				const x = Math.max(0, r.left - padding);
				const y = Math.max(0, r.top - padding);
				const right = Math.min(window.innerWidth, r.right + padding);
				const bottom = Math.min(window.innerHeight, r.bottom + padding);
				return {
					ok: true,
					clip: {
						x,
						y,
						width: Math.max(1, right - x),
						height: Math.max(1, bottom - y),
						scale: 1
					}
				};
			})()`,
			signal,
		),
		"element screenshot geometry",
	);
	if (value["ok"] !== true) {
		throw new Error(
			typeof value["error"] === "string"
				? value["error"]
				: `Could not capture ${selector}`,
		);
	}
	const clipRecord = asRecord(value["clip"], "element screenshot clip");
	const [x, y, width, height] = ["x", "y", "width", "height"].map((field) =>
		Number(clipRecord[field]),
	);
	if (
		x === undefined ||
		y === undefined ||
		width === undefined ||
		height === undefined ||
		![x, y, width, height].every(Number.isFinite) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error("Element has an invalid screenshot box");
	}
	const clip: ScreenshotClip = {
		x,
		y,
		width,
		height,
		scale: 1,
	};
	return capture(cdp, sessionId, file, clip, signal);
}

export async function captureRef(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	id: number | string,
	file: string,
	signal?: AbortSignal,
): Promise<ScreenshotCapture> {
	const ref = requireElementRef(elementRefs, id);
	await scrollBackendIntoView(cdp, sessionId, ref.backendNodeId, signal);
	const response = asRecord(
		await cdp.send(
			"DOM.getBoxModel",
			{ backendNodeId: ref.backendNodeId },
			sessionId,
			signal,
		),
		"DOM box model",
	);
	const model = asRecord(response["model"], "DOM box model");
	const border = model["border"];
	if (
		!Array.isArray(border) ||
		!border.every((value) => typeof value === "number")
	) {
		throw new Error("Element has no screenshot box");
	}
	const clip = await visibleElementClip(cdp, sessionId, border, 10, signal);
	return capture(cdp, sessionId, file, clip, signal);
}
