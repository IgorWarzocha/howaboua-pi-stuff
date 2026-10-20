// @ts-check
import { api } from "./api.js";
import { date, element } from "./view-dom.js";

/** @typedef {import('../src/custom-tabs/index.ts').CustomTab} CustomTab */
/** @typedef {import('../src/custom-tabs/index.ts').TabSnapshot} TabSnapshot */
/** @typedef {import('../src/custom-tabs/index.ts').TabCatalog} TabCatalog */

/** @param {() => URLSearchParams} getQuery */
export function createCustomTabsView(getQuery) {
	const panel = element("custom-tab-panel");
	const host = element("custom-tab-frame");
	const status = element("custom-tab-status");
	const error = element("custom-tab-error");
	const pageStatus = element("custom-tab-page-status");
	const filterNotice = element("custom-tab-filters");
	/** @type {Map<string, CustomTab>} */
	const tabs = new Map();
	/** @type {CustomTab | undefined} */ let active;
	/** @type {TabSnapshot | undefined} */ let latest;
	/** @type {HTMLIFrameElement | undefined} */ let frame;
	/** @type {AbortController | undefined} */ let request;
	let ready = false;
	let stopped = false;
	let transportError = "";
	let sent = "";

	function context() {
		if (!active) return;
		const query = getQuery();
		const unused = Object.entries({
			session: "Session",
			project: "Project",
			since: "From",
			until: "Until",
		})
			.filter(
				([key]) =>
					query.get(key) && !active?.filters.some((filter) => filter === key),
			)
			.map(([, label]) => label);
		filterNotice.hidden = !unused.length;
		filterNotice.textContent = unused.length
			? `Filters not used by this tab: ${unused.join(", ")}.`
			: "";
		if (!ready || !frame || !latest) return;
		const metadata = {
			status: {
				...latest.status,
				error: transportError || latest.status.error,
			},
			filters: Object.fromEntries(
				active.filters.map((key) => [key, query.get(key) ?? ""]),
			),
		};
		const signature = JSON.stringify(metadata);
		if (signature === sent) return;
		sent = signature;
		frame.contentWindow?.postMessage(
			{
				type: "observatory-tab-update",
				version: 1,
				state: { data: latest.data, ...metadata },
			},
			location.origin,
		);
	}
	function renderStatus() {
		const state = latest?.status;
		status.textContent = state?.updatedAt
			? `Updated ${date(state.updatedAt)}${state.running ? " · Collecting" : ""}`
			: state?.running
				? "Collecting first snapshot…"
				: "No snapshot yet";
		error.textContent = transportError || state?.error || "";
		error.hidden = !error.textContent;
		context();
	}
	async function refresh() {
		if (!active || request || stopped) return;
		const tab = active;
		const controller = (request = new AbortController());
		try {
			/** @type {TabCatalog} */
			const catalog = await api("/api/tabs", controller.signal);
			const current = catalog.tabs.find((item) => item.id === tab.id);
			if (!current)
				throw new Error(
					"This tab is no longer available. Reload the dashboard to update its tabs.",
				);
			const snapshot =
				!latest || latest.status.updatedAt !== current.status.updatedAt
					? await api(`/api/tabs/${tab.id}`, controller.signal)
					: { ...latest, status: current.status };
			if (controller.signal.aborted || request !== controller) return;
			latest = snapshot;
			transportError = "";
		} catch (failure) {
			if (controller.signal.aborted) return;
			transportError =
				failure instanceof Error ? failure.message : String(failure);
		} finally {
			if (request === controller) {
				request = undefined;
				renderStatus();
			}
		}
	}
	/** @param {MessageEvent} event */
	function receive(event) {
		if (
			event.source !== frame?.contentWindow ||
			event.origin !== location.origin
		)
			return;
		if (
			event.data?.type === "observatory-tab-size" &&
			event.data.version === 1
		) {
			const height = event.data.height;
			if (frame && Number.isFinite(height) && height > 0)
				frame.style.height = `${Math.ceil(height)}px`;
			return;
		}
		if (
			event.data?.type !== "observatory-tab-ready" ||
			event.data.version !== 1
		)
			return;
		ready = true;
		sent = "";
		pageStatus.hidden = true;
		context();
	}
	window.addEventListener("message", receive);
	return {
		async load() {
			const notice = element("custom-tabs-errors");
			const controller = (request = new AbortController());
			try {
				/** @type {TabCatalog} */ const catalog = await api(
					"/api/tabs",
					AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
				);
				if (stopped) return;
				for (const tab of catalog.tabs) {
					tabs.set(tab.id, tab);
					const button = document.createElement("button");
					button.type = "button";
					button.dataset["view"] = `custom:${tab.id}`;
					button.setAttribute("aria-pressed", "false");
					button.textContent = tab.title;
					element("view-nav").append(button);
				}
				notice.textContent = catalog.errors.join("\n");
			} catch {
				if (stopped) return;
				notice.textContent =
					"Custom tabs could not be loaded. The built-in views remain available. Reload to retry.";
			} finally {
				if (request === controller) request = undefined;
			}
			notice.hidden = !notice.textContent;
		},
		/** @param {string} id */
		has(id) {
			return tabs.has(id);
		},
		/** @param {string | null} id */
		show(id) {
			const next = id ? tabs.get(id) : undefined;
			if (next === active) return;
			request?.abort();
			request = undefined;
			active = next;
			latest = undefined;
			ready = false;
			transportError = "";
			host.replaceChildren();
			frame = undefined;
			panel.hidden = !next;
			if (!next) return;
			element("custom-tab-heading").textContent = next.title;
			pageStatus.hidden = false;
			pageStatus.textContent = "Loading tab…";
			frame = document.createElement("iframe");
			frame.title = next.title;
			frame.src = next.entry;
			frame.addEventListener("load", () => {
				if (!ready)
					pageStatus.textContent =
						"The tab page has not connected. Check that it uses connectTab from /tab-client.js.";
			});
			host.append(frame);
			renderStatus();
			void refresh();
		},
		context,
		refresh,
		dispose() {
			stopped = true;
			request?.abort();
			window.removeEventListener("message", receive);
			host.replaceChildren();
		},
	};
}
