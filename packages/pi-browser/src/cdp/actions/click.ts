import { sleep } from "../discovery.js";
import type { CdpConnection, ElementRefs } from "../types.js";
import {
	backendCenter,
	type ElementPoint,
	requireElementRef,
} from "./element.js";
import { selectorBackendNode } from "./selector.js";

function dispatchMouse(
	cdp: CdpConnection,
	sessionId: string,
	type: "mouseMoved" | "mousePressed" | "mouseReleased",
	point: Pick<ElementPoint, "x" | "y">,
	signal?: AbortSignal,
): Promise<unknown> {
	return cdp.send(
		"Input.dispatchMouseEvent",
		{
			x: point.x,
			y: point.y,
			button: "left",
			clickCount: 1,
			modifiers: 0,
			type,
		},
		sessionId,
		signal,
	);
}

async function pressAndRelease(
	cdp: CdpConnection,
	sessionId: string,
	point: Pick<ElementPoint, "x" | "y">,
	signal?: AbortSignal,
): Promise<void> {
	let pressed = false;
	try {
		await dispatchMouse(cdp, sessionId, "mousePressed", point, signal);
		pressed = true;
		await sleep(50, signal);
		await dispatchMouse(cdp, sessionId, "mouseReleased", point, signal);
		pressed = false;
	} finally {
		if (pressed) {
			await dispatchMouse(
				cdp,
				sessionId,
				"mouseReleased",
				point,
				undefined,
			).catch(() => undefined);
		}
	}
}

async function clickBackendNode(
	cdp: CdpConnection,
	sessionId: string,
	backendNodeId: number,
	signal?: AbortSignal,
): Promise<ElementPoint> {
	const initial = await backendCenter(
		cdp,
		sessionId,
		backendNodeId,
		true,
		signal,
	);
	await dispatchMouse(cdp, sessionId, "mouseMoved", initial, signal);
	const point = await backendCenter(
		cdp,
		sessionId,
		backendNodeId,
		false,
		signal,
	);
	await pressAndRelease(cdp, sessionId, point, signal);
	return point;
}

export async function clickSelector(
	cdp: CdpConnection,
	sessionId: string,
	selector: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!selector) throw new Error("CSS selector required");
	const backendNodeId = await selectorBackendNode(
		cdp,
		sessionId,
		selector,
		signal,
	);
	const point = await clickBackendNode(cdp, sessionId, backendNodeId, signal);
	return `Clicked <${point.tag}> "${point.text}"`;
}

export async function clickRef(
	cdp: CdpConnection,
	sessionId: string,
	elementRefs: ElementRefs,
	id: number | string,
	signal?: AbortSignal,
): Promise<string> {
	const ref = requireElementRef(elementRefs, id);
	await clickBackendNode(cdp, sessionId, ref.backendNodeId, signal);
	return `Clicked element ${ref.id}`;
}

export async function clickCoordinates(
	cdp: CdpConnection,
	sessionId: string,
	x: number,
	y: number,
	signal?: AbortSignal,
): Promise<string> {
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error("x and y must be finite CSS-pixel numbers");
	}
	const point = { x, y };
	await dispatchMouse(cdp, sessionId, "mouseMoved", point, signal);
	await pressAndRelease(cdp, sessionId, point, signal);
	return `Clicked at CSS (${x}, ${y})`;
}
