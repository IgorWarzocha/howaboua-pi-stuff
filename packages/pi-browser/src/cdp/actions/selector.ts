import type { CdpConnection } from "../types.js";
import { asRecord } from "../types.js";

export async function selectorBackendNode(
	cdp: CdpConnection,
	sessionId: string,
	selector: string,
	signal?: AbortSignal,
): Promise<number> {
	await cdp.send("Runtime.enable", {}, sessionId, signal);
	const selected = asRecord(
		await cdp.send(
			"Runtime.evaluate",
			{
				expression: `(() => {
					const selector = ${JSON.stringify(selector)};
					const matches = document.querySelectorAll(selector);
					if (matches.length === 0) throw new Error('Element not found: ' + selector);
					if (matches.length > 1) throw new Error(
						'Selector matched ' + matches.length + ' elements: ' + selector
					);
					return matches[0];
				})()`,
				returnByValue: false,
				awaitPromise: true,
			},
			sessionId,
			signal,
		),
		"selector response",
	);
	if (selected["exceptionDetails"]) {
		const details = asRecord(
			selected["exceptionDetails"],
			"selector exception",
		);
		throw new Error(
			typeof details["text"] === "string"
				? details["text"]
				: `Could not select ${selector}`,
		);
	}
	const result = asRecord(selected["result"], "selector result");
	if (typeof result["objectId"] !== "string") {
		throw new Error(`Element is no longer available: ${selector}`);
	}
	const objectId = result["objectId"];
	try {
		const described = asRecord(
			await cdp.send("DOM.describeNode", { objectId }, sessionId, signal),
			"DOM.describeNode response",
		);
		const node = asRecord(described["node"], "described node");
		if (typeof node["backendNodeId"] !== "number") {
			throw new Error(`Element is no longer available: ${selector}`);
		}
		return node["backendNodeId"];
	} finally {
		await cdp
			.send("Runtime.releaseObject", { objectId }, sessionId, undefined)
			.catch(() => undefined);
	}
}
