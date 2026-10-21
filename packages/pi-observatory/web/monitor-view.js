// @ts-check
import { api, report } from "./api.js";
import { element } from "./view-dom.js";

export function createMonitorControl() {
	const button = /** @type {HTMLButtonElement} */ (element("monitor"));
	button.disabled = true;
	/** @type {import('../src/monitor.ts').MonitorStatus} */
	let status = { mode: "paused", busy: false, revision: -1 };
	/** @type {ReturnType<typeof setTimeout> | undefined} */ let hold;
	let suppressClick = false;
	let sequence = 0;
	let stopped = false;
	const controller = new AbortController();
	function render() {
		const state =
			status.mode === "live"
				? "live"
				: status.busy || status.mode === "catch-up"
					? "sync"
					: "paused";
		button.dataset["state"] = state;
		const label =
			state === "live"
				? "Live monitoring. Click to pause."
				: state === "sync"
					? status.mode === "paused"
						? "Pausing…"
						: "Updating once. Click to pause; hold 2 seconds for live monitoring."
					: "Paused. Click to update once; hold 2 seconds for live monitoring.";
		button.setAttribute("aria-label", label);
		button.title = `${label} Keyboard: hold Space for live monitoring.`;
	}
	/** @param {import('../src/monitor.ts').MonitorMode} mode */
	async function select(mode) {
		const request = ++sequence;
		try {
			const response = await fetch(`/api/monitor?mode=${mode}`, {
				method: "POST",
				signal: controller.signal,
			});
			if (!response.ok)
				throw new Error(
					`Could not change monitoring (${response.status}). Retry.`,
				);
			const next = await response.json();
			if (request !== sequence || stopped) return;
			status = next;
			render();
		} catch (error) {
			if (!stopped) report(error);
		}
	}
	function cancelHold() {
		clearTimeout(hold);
		hold = undefined;
		button.classList.remove("holding");
	}
	function beginHold() {
		cancelHold();
		suppressClick = false;
		if (status.mode === "live") return;
		button.classList.add("holding");
		hold = setTimeout(() => {
			suppressClick = true;
			cancelHold();
			void select("live");
		}, 2000);
	}
	function activate() {
		cancelHold();
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		void select(
			status.mode === "paused" && !status.busy ? "catch-up" : "paused",
		);
	}
	button.addEventListener("pointerdown", (event) => {
		if (event.button === 0 && event.isPrimary) beginHold();
	});
	button.addEventListener("pointerup", cancelHold);
	for (const event of ["pointercancel", "pointerleave", "blur"])
		button.addEventListener(event, () => {
			if (hold) suppressClick = true;
			cancelHold();
		});
	button.addEventListener("contextmenu", (event) => event.preventDefault());
	button.addEventListener("click", activate);
	button.addEventListener("keydown", (event) => {
		if (event.key === " ") {
			event.preventDefault();
			if (!event.repeat) beginHold();
		} else if (event.key === "Enter") suppressClick = false;
		else if (event.key === "Escape") {
			suppressClick = true;
			cancelHold();
		}
	});
	button.addEventListener("keyup", (event) => {
		if (event.key === " ") {
			event.preventDefault();
			activate();
		}
	});
	window.addEventListener("blur", cancelHold, { signal: controller.signal });
	render();
	return {
		async refresh() {
			const request = sequence;
			const next = await api("/api/monitor", controller.signal);
			if (request === sequence && !stopped) {
				status = next;
				button.disabled = false;
				render();
			}
			return status;
		},
		dispose() {
			stopped = true;
			cancelHold();
			controller.abort();
		},
	};
}
