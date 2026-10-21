// @ts-check
import { api, report } from "./api.js";
import {
	button,
	date,
	element,
	node,
	number,
	outcomeLabel,
	table,
} from "./view-dom.js";

/** @param {() => URLSearchParams} getQuery @param {(id: number) => void} selectCall @param {() => void} pageChanged */
export function createCallsView(getQuery, selectCall, pageChanged) {
	const outcome = /** @type {HTMLSelectElement} */ (element("outcome"));
	const older = /** @type {HTMLButtonElement} */ (element("older"));
	const newer = /** @type {HTMLButtonElement} */ (element("newer"));
	const newest = /** @type {HTMLButtonElement} */ (element("newest"));
	const refresh = /** @type {HTMLButtonElement} */ (element("new-data"));
	/** @type {Array<number | null>} */ let pageCursors = [null];
	let pageIndex = 0;
	/** @type {number | null} */ let nextCursor = null;
	/** @type {number | null} */ let selected = null;

	/** @type {AbortController | undefined} */ let callsRequest;
	/** @type {AbortController | undefined} */ let detailRequest;
	/** @type {Map<number, HTMLButtonElement>} */ let callButtons = new Map();

	/** @param {number} [targetPage] @param {number | null} [targetCursor] */
	async function refreshCalls(targetPage = 0, targetCursor = null) {
		const pagerFocus = [older, newer, newest, refresh].find(
			(button) => button === document.activeElement,
		);
		callsRequest?.abort();
		const request = (callsRequest = new AbortController());
		const params = new URLSearchParams(getQuery());
		params.set("outcome", outcome.value);
		params.set("limit", "20");
		if (targetCursor !== null) params.set("cursor", String(targetCursor));
		element("calls-status").textContent = "Loading calls…";
		older.disabled = true;
		newer.disabled = true;
		newest.disabled = true;
		refresh.disabled = true;
		element("calls").setAttribute("aria-busy", "true");
		let loaded = false;
		try {
			/** @type {import('../src/contracts.ts').CallPage} */
			const page = await api(`/api/calls?${params}`, request.signal);
			if (request.signal.aborted) return;
			pageIndex = targetPage;
			pageCursors =
				targetPage === 0 ? [null] : pageCursors.slice(0, targetPage);
			pageCursors[targetPage] = targetCursor;
			nextCursor = page.nextCursor;
			callButtons = new Map();
			const rows = page.rows.map((call) => {
				const action = button(date(call.timestamp), () => selectCall(call.id));
				callButtons.set(call.id, action);
				const tool = node("div", "");
				tool.append(
					node("strong", call.tool),
					node("small", `${call.provider} / ${call.model}`),
				);
				tool.className = "call-tool";
				const result = node(
					"span",
					outcomeLabel(call.outcome) +
						(call.exitCode === null ? "" : ` (${call.exitCode})`),
				);
				result.className = `outcome-badge outcome-${call.outcome}`;
				const preview = node("span", call.signature || call.preview || "—");
				preview.className = "call-preview";
				preview.title = call.signature || call.preview;
				return [action, tool, result, call.scope, preview];
			});
			element("calls").replaceChildren(
				table(
					["Time", "Operation / Model", "Outcome", "Scope", "Preview"],
					rows,
					"No matching calls.",
				),
			);
			element("calls-status").textContent = page.rows.length
				? `${number(pageIndex * 20 + 1)}–${number(pageIndex * 20 + page.rows.length)} calls`
				: "No matching calls";
			element("calls-page").textContent = `Page ${pageIndex + 1}`;
			element("calls").scrollTop = 0;
			refresh.hidden = true;
			markSelected();
			loaded = true;
			pageChanged();
		} catch (error) {
			if (!request.signal.aborted) {
				refresh.hidden = false;
				element("calls-status").textContent =
					"Could not load calls; previous results may still be shown. Use Refresh calls to retry.";
			}
			report(error);
		} finally {
			if (!request.signal.aborted) {
				older.disabled = !loaded || nextCursor === null;
				newer.disabled = newest.disabled = !loaded || pageIndex === 0;
				refresh.disabled = false;
				element("calls").setAttribute("aria-busy", "false");
				if (
					pagerFocus &&
					(document.activeElement === document.body ||
						(document.activeElement === refresh && refresh.hidden))
				) {
					const focus =
						!pagerFocus.disabled && !pagerFocus.hidden
							? pagerFocus
							: [newer, older, newest].find((button) => !button.disabled);
					(focus || outcome).focus({ preventScroll: true });
				}
			}
		}
	}
	function markSelected() {
		for (const [id, b] of callButtons) {
			const row = b.closest("tr");
			row?.setAttribute("aria-selected", String(id === selected));
			b.setAttribute("aria-expanded", String(id === selected));
			b.setAttribute("aria-controls", "detail");
		}
	}
	/** @param {number} id */
	async function openDetail(id) {
		detailRequest?.abort();
		const request = (detailRequest = new AbortController());
		selected = id;
		markSelected();
		element("detail").hidden = false;
		element("detail-status").textContent = "Loading call…";
		element("detail-content").replaceChildren();
		element("detail-heading").focus({ preventScroll: true });
		try {
			/** @type {import('../src/contracts.ts').CallDetail} */
			const detail = await api(`/api/calls/${id}`, request.signal);
			if (request.signal.aborted) return;
			element("detail-status").textContent =
				`${detail.call.tool} · ${outcomeLabel(detail.call.outcome)} · ${date(detail.call.timestamp)}`;
			const content = element("detail-content");
			const metadata = document.createElement("dl");
			for (const [key, value] of Object.entries({
				Provider: detail.call.provider,
				Model: detail.call.model,
				Project: detail.call.project,
				Scope: detail.call.scope,
				Source: `${detail.path}:${detail.line}`,
				Session: detail.sessionId,
				"Call ID": detail.callId,
				"Parent call": detail.parentCallId || "—",
			}))
				metadata.append(node("dt", key), node("dd", value));
			content.append(metadata);
			const notes = document.createElement("ul");
			for (const text of detail.notes) notes.append(node("li", text));
			if (detail.notes.length) content.append(notes);
			for (const observation of detail.observations) {
				const observed = document.createElement("details");
				observed.append(
					node("summary", `Live observation: ${observation.callId}`),
				);
				observed.append(
					node(
						"p",
						`${observation.source || "Tool source not recorded"}${observation.durationMs === null ? "" : ` · ${observation.durationMs} ms`}`,
					),
				);
				if (observation.callId !== detail.callId) {
					observed.append(
						node("h3", "Arguments"),
						node("pre", observation.arguments || "Not recorded"),
					);
					observed.append(
						node("h3", "Result"),
						node("pre", observation.result || "No final result recorded"),
					);
				}
				content.append(observed);
			}
			content.append(
				node("h3", "Arguments"),
				node("pre", detail.arguments),
				node("h3", "Result"),
				node("pre", detail.result),
				node("h3", "Context"),
			);
			if (!detail.context.length)
				content.append(node("p", "No neighbouring messages are available."));
			for (const message of detail.context) {
				const item = document.createElement("details");
				item.append(
					node(
						"summary",
						`${message.role} · line ${message.line} · ${date(message.timestamp)}`,
					),
					node("pre", message.text),
				);
				content.append(item);
			}
		} catch (error) {
			if (!request.signal.aborted)
				element("detail-status").textContent =
					"Detail could not be loaded. Select the call again to retry.";
			report(error);
		}
	}

	older.addEventListener("click", () => {
		if (nextCursor !== null) {
			void refreshCalls(pageIndex + 1, nextCursor);
		}
	});
	newer.addEventListener("click", () => {
		if (pageIndex > 0)
			void refreshCalls(pageIndex - 1, pageCursors[pageIndex - 1] ?? null);
	});
	newest.addEventListener("click", () => void refreshCalls());
	refresh.addEventListener("click", () => {
		element("error").hidden = true;
		void refreshCalls();
	});

	function closeDetail() {
		detailRequest?.abort();
		selected = null;
		element("detail").hidden = true;
		markSelected();
	}
	return {
		refresh: refreshCalls,
		resetPage: () => {
			pageIndex = 0;
			pageCursors = [null];
			nextCursor = null;
		},
		openDetail,
		closeDetail,
		snapshot: () => ({
			call: selected,
			cursors: pageCursors.slice(0, pageIndex + 1),
		}),
		/** @param {Array<number | null>} cursors */
		restorePage: async (cursors) => {
			if (cursors.length <= 1) return;
			pageCursors = cursors;
			await refreshCalls(cursors.length - 1, cursors.at(-1));
		},
		dispose: () => {
			callsRequest?.abort();
			detailRequest?.abort();
		},
	};
}
