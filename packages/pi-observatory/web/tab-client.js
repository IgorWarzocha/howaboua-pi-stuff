// @ts-check

/** @typedef {import('../src/custom-tabs/index.ts').TabSnapshot & {filters: Partial<Record<'session' | 'project' | 'since' | 'until', string>>}} TabState */

/** @param {unknown} value @returns {value is TabState} */
function validState(value) {
	if (
		!value ||
		typeof value !== "object" ||
		!("data" in value) ||
		!("status" in value) ||
		!("filters" in value)
	)
		return false;
	const { status, filters } = value;
	if (
		!status ||
		typeof status !== "object" ||
		!("running" in status) ||
		typeof status.running !== "boolean"
	)
		return false;
	for (const key of ["lastStartedAt", "updatedAt", "error"]) {
		if (!(key in status)) return false;
		const item = Reflect.get(status, key);
		if (item !== null && typeof item !== "string") return false;
	}
	return Boolean(
		filters &&
			typeof filters === "object" &&
			!Array.isArray(filters) &&
			Object.entries(filters).every(
				([key, item]) =>
					["session", "project", "since", "until"].includes(key) &&
					typeof item === "string",
			),
	);
}

/** Receive snapshots and declared dashboard filters. Returns a disconnect function. @param {(state: TabState) => void} render */
export function connectTab(render) {
	let pendingSize = 0;
	let lastHeight = 0;
	const sizeObserver = new ResizeObserver(() => {
		if (pendingSize) return;
		pendingSize = requestAnimationFrame(() => {
			pendingSize = 0;
			// scrollHeight is at least the frame viewport, so it cannot reliably shrink.
			const height = Math.max(
				1,
				Math.ceil(document.documentElement.getBoundingClientRect().height),
			);
			if (height === lastHeight) return;
			lastHeight = height;
			window.parent.postMessage(
				{ type: "observatory-tab-size", version: 1, height },
				location.origin,
			);
		});
	});
	sizeObserver.observe(document.documentElement);
	/** @param {MessageEvent} event */
	function receive(event) {
		if (event.source !== window.parent || event.origin !== location.origin)
			return;
		const message = event.data;
		if (
			message?.type === "observatory-tab-update" &&
			message.version === 1 &&
			validState(message.state)
		)
			render(message.state);
	}
	window.addEventListener("message", receive);
	window.parent.postMessage(
		{ type: "observatory-tab-ready", version: 1 },
		location.origin,
	);
	return () => {
		window.removeEventListener("message", receive);
		sizeObserver.disconnect();
		cancelAnimationFrame(pendingSize);
	};
}
