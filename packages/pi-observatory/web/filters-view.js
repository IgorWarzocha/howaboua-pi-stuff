// @ts-check
import { api, report } from "./api.js";
import { date, element } from "./view-dom.js";

/** @param {() => void} onApply */
export function createFiltersView(onApply) {
	const form = /** @type {HTMLFormElement} */ (element("filters"));
	const panel = element("filter-panel");
	const toggle = element("toggle-filters");
	/** @param {boolean} open */
	function showFilters(open) {
		panel.hidden = !open;
		toggle.setAttribute("aria-expanded", String(open));
	}
	toggle.addEventListener("click", () => showFilters(Boolean(panel.hidden)));
	/** @param {string} name */
	function field(name) {
		const node = form.elements.namedItem(name);
		if (
			!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement)
		)
			throw new Error(`Missing filter: ${name}`);
		return node;
	}
	const outcome = /** @type {HTMLSelectElement} */ (element("outcome"));
	const sessionSelect = /** @type {HTMLSelectElement} */ (element("session"));
	const sessionSearch = /** @type {HTMLInputElement} */ (
		element("session-search")
	);
	const entryParams = new URLSearchParams(location.search);
	const entrySession = entryParams.get("session") || "";
	const initialSession = entryParams.has("current")
		? entryParams.get("current") || ""
		: entrySession;
	if (initialSession) {
		entryParams.set("current", initialSession);
		history.replaceState(
			history.state,
			"",
			`${location.pathname}?${entryParams}${location.hash}`,
		);
		sessionSelect.append(
			new Option(
				`Current session · ${initialSession.slice(0, 8)}`,
				initialSession,
				true,
				entrySession === initialSession,
			),
		);
		element("current-session").hidden = false;
		element("reset-filters").textContent = "Reset to current session";
	}
	if (entrySession && entrySession !== initialSession)
		sessionSelect.append(
			new Option(`Session · ${entrySession.slice(0, 8)}`, entrySession),
		);
	sessionSelect.value = entrySession;
	const fragment = new URLSearchParams(location.hash.slice(1));
	if (fragment.has("token")) {
		fragment.delete("token");
		history.replaceState(
			history.state,
			"",
			location.pathname +
				location.search +
				(fragment.size ? `#${fragment}` : ""),
		);
	}
	try {
		sessionStorage.removeItem("pi-observatory-token");
	} catch {
		// Storage may be disabled; the viewer does not require it.
	}

	/** @type {AbortController | undefined} */ let sessionsRequest;
	/** @type {ReturnType<typeof setTimeout> | undefined} */ let sessionSearchTimer;

	/** @param {string} filters */
	function restoreFilters(filters) {
		const saved = new URLSearchParams(filters);
		for (const control of form.elements) {
			if (
				!(
					control instanceof HTMLInputElement ||
					control instanceof HTMLSelectElement
				) ||
				!control.name
			)
				continue;
			const value =
				saved.get(control.name) ?? (control.name === "scope" ? "all" : "");
			if (
				control instanceof HTMLSelectElement &&
				!Array.from(control.options).some((option) => option.value === value)
			)
				control.add(new Option(value, value));
			control.value = value;
		}
	}

	/** @param {HTMLSelectElement} select @param {string[]} values */
	function options(select, values) {
		const current = select.value;
		const existing = Array.from(select.options)
			.slice(1)
			.map((o) => o.value);
		const desired = [...new Set(values)].sort();
		if (current && !desired.includes(current)) desired.push(current);
		if (existing.join("\0") === desired.join("\0")) return;
		const first = select.options[0];
		if (!first) throw new Error("Missing default filter option");
		select.replaceChildren(
			first,
			...desired.map((value) => new Option(value, value)),
		);
		select.value = current;
	}
	/** @param {import('../src/contracts.ts').Facets} facets */
	function renderFacets(facets) {
		options(
			/** @type {HTMLSelectElement} */ (field("provider")),
			facets.models.map((m) => m.provider),
		);
		options(
			/** @type {HTMLSelectElement} */ (field("model")),
			facets.models.map((m) => m.model),
		);
		options(/** @type {HTMLSelectElement} */ (field("tool")), facets.tools);
		options(
			/** @type {HTMLSelectElement} */ (field("project")),
			facets.projects,
		);
	}
	async function refreshSessions() {
		clearTimeout(sessionSearchTimer);
		sessionsRequest?.abort();
		const request = (sessionsRequest = new AbortController());
		const params = new URLSearchParams({ q: sessionSearch.value.trim() });
		try {
			/** @type {import('../src/contracts.ts').SessionPage} */
			const page = await api(`/api/sessions?${params}`, request.signal);
			if (request.signal.aborted) return;
			// A native picker may be open while indexing updates arrive.
			if (document.activeElement === sessionSelect) return;
			const current = sessionSelect.value;
			const retained = Array.from(sessionSelect.options).filter(
				(option) =>
					option.value &&
					(option.value === current || option.value === initialSession),
			);
			const choices = new Map(
				retained.map((option) => [
					option.value,
					option.textContent || option.value,
				]),
			);
			for (const session of page.sessions) {
				choices.set(
					session.id,
					`${session.id === initialSession ? "Current session · " : ""}${session.project || "(no project)"} · ${date(session.updatedAt)} · ${session.id.slice(0, 8)}`,
				);
			}
			const desired = [
				new Option("All sessions", "", !initialSession),
				...Array.from(
					choices,
					([id, label]) => new Option(label, id, id === initialSession),
				),
			];
			const existing = Array.from(sessionSelect.options);
			if (
				existing.length !== desired.length ||
				desired.some(
					(option, index) =>
						option.value !== existing[index]?.value ||
						option.textContent !== existing[index]?.textContent,
				)
			) {
				sessionSelect.replaceChildren(...desired);
				sessionSelect.value = current;
			}
			element("sessions-status").textContent =
				`${page.sessions.length} ${params.get("q") ? "matching" : "recent"} sessions${page.hasMore ? " · Search for more" : ""}`;
		} catch (error) {
			if (!request.signal.aborted) {
				element("sessions-status").textContent =
					"Session choices could not be loaded. Edit the search or refresh to retry; your selected scope is unchanged.";
				report(error);
			}
		}
	}

	function readFilters() {
		const query = new URLSearchParams();
		for (const [key, value] of new FormData(form)) {
			if (typeof value !== "string") continue;
			const filtered = key === "signature" ? value : value.trim();
			if (filtered) query.set(key, filtered);
		}
		element("pattern").hidden = !query.has("signature");
		element("pattern-text").textContent = query.has("signature")
			? `${query.get("tool") || "All operations"} · ${query.get("model") || "All models"} · ${query.get("signature")}`
			: "";
		const active = Array.from(query).filter(
			([key, value]) => key !== "scope" || value !== "all",
		);
		element("filter-count").textContent = String(active.length);
		element("filter-count").hidden = active.length === 0;
		toggle.setAttribute(
			"aria-label",
			active.length ? `Filters, ${active.length} active` : "Filters",
		);

		return query;
	}
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		onApply();
		showFilters(false);
		toggle.focus({ preventScroll: true });
	});
	form.addEventListener("reset", () => {
		sessionSearch.value = "";
		field("signature").value = "";
		outcome.value = "all";
		setTimeout(onApply, 0);
	});
	element("clear-pattern").addEventListener("click", () => {
		field("signature").value = "";
		onApply();
	});
	sessionSelect.addEventListener("change", () => onApply());
	sessionSelect.addEventListener("blur", () => void refreshSessions());
	element("all-sessions").addEventListener("click", () => {
		sessionSelect.value = "";
		onApply();
	});
	element("current-session").addEventListener("click", () => {
		sessionSelect.value = initialSession;
		onApply();
	});
	sessionSearch.addEventListener("input", () => {
		clearTimeout(sessionSearchTimer);
		sessionsRequest?.abort();
		sessionSearchTimer = setTimeout(refreshSessions, 200);
	});

	return {
		read: readFilters,
		restore: restoreFilters,
		renderFacets,
		refreshSessions,
		dispose: () => {
			sessionsRequest?.abort();
			clearTimeout(sessionSearchTimer);
		},
	};
}
