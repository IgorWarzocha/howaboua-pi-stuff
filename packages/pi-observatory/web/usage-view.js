// @ts-check

/** @typedef {import('../src/usage.ts').UsageRow} UsageRow */
/** @typedef {import('../src/usage.ts').UsageOverview} UsageOverview */

const PAGE_SIZE = 10;
const CHART_LIMIT = 8;

/** @template {keyof HTMLElementTagNameMap} T @param {T} tag @param {string} text @param {string} [className] */
function textNode(tag, text, className) {
	const node = document.createElement(tag);
	node.textContent = text;
	if (className) node.className = className;
	return node;
}

/** @param {string | null} value */
function timestamp(value) {
	return value ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "—";
}

/** @param {"Previous" | "Next"} direction @param {() => void} select */
function pageButton(direction, select) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "page-button";
	button.setAttribute("aria-label", `${direction} resource page`);
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.setAttribute("viewBox", "0 0 20 20");
	icon.setAttribute("width", "16");
	icon.setAttribute("height", "16");
	icon.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		direction === "Previous" ? "m12 4-6 6 6 6" : "m8 4 6 6-6 6",
	);
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", "currentColor");
	path.setAttribute("stroke-width", "1.8");
	icon.append(path);
	const label = textNode("span", direction);
	button.append(...(direction === "Previous" ? [icon, label] : [label, icon]));
	button.addEventListener("click", select);
	return button;
}

/** User command submissions and agent skill reads intentionally have separate views. */
export function createUsageView() {
	/** @param {string} id */
	function element(id) {
		const node = document.getElementById(id);
		if (!node) throw new Error(`Missing element: ${id}`);
		return node;
	}
	const view = /** @type {HTMLSelectElement} */ (element("usage-view"));
	const search = /** @type {HTMLInputElement} */ (element("usage-search"));
	const sort = /** @type {HTMLSelectElement} */ (element("usage-sort"));
	const zero = /** @type {HTMLSelectElement} */ (element("usage-zero"));
	const zeroOption = element("usage-zero-option");
	const zeroLabel = element("usage-zero-label");
	const target = element("usage-table");
	const summary = element("usage-summary");
	const chart = element("usage-chart");
	const partialHistory = element("usage-partial-history");
	const pagination = element("usage-pagination");
	const range = textNode("span", "", "page-range");
	const pageInfo = textNode("span", "", "page-info");
	const previous = pageButton("Previous", () => changePage(-1));
	const next = pageButton("Next", () => changePage(1));
	pagination.classList.add("pagination");
	pagination.setAttribute("aria-label", "Resource pages");
	pagination.replaceChildren(range, previous, pageInfo, next);
	/** @type {UsageOverview | undefined} */
	let latest;
	let page = 0;
	let scope = "";

	/** @param {UsageRow} row */
	function uses(row) {
		return view.value === "skills"
			? row.skillReads +
					row.referenceReads +
					row.fileReads +
					row.fileReferenceReads
			: row.submissions;
	}

	/** @param {UsageRow} row */
	function name(row) {
		return view.value === "skills"
			? row.name
			: `/${row.kind === "skill" ? "skill:" : ""}${row.name}`;
	}

	/** @param {UsageRow} row @param {boolean} recorded @param {Set<string>} expanded */
	function resource(row, recorded, expanded) {
		const cell = document.createElement("td");
		cell.append(textNode("strong", name(row), "capability-name"));
		if (view.value !== "skills")
			cell.append(textNode("span", row.kind, "muted capability-kind"));
		const details = document.createElement("details");
		details.dataset["resource"] = JSON.stringify([
			row.kind,
			row.name,
			row.path,
		]);
		details.open = expanded.has(details.dataset["resource"]);
		details.append(
			textNode(
				"summary",
				view.value === "skills" ? "Evidence & source" : "Source & availability",
			),
		);
		if (view.value === "skills")
			details.append(
				textNode(
					"p",
					`${row.fileReads.toLocaleString()} inferred body reads · ${row.fileReferenceReads.toLocaleString()} inferred reference reads · ${row.skillReads.toLocaleString()} confirmed body reads · ${row.referenceReads.toLocaleString()} confirmed reference reads · ${row.continuations.toLocaleString()} continuations (separate from read totals) · ${row.submissions || recorded ? row.submissions.toLocaleString() : "unavailable"} user skill submissions (not agent reads)`,
				),
			);
		if (row.owner) details.append(textNode("p", `Source: ${row.owner}`));
		if (row.path) details.append(textNode("p", row.path, "source-path"));
		if (row.firstAvailable)
			details.append(
				textNode(
					"p",
					`First inventory snapshot: ${timestamp(row.firstAvailable)}`,
				),
			);
		if (row.lastAvailable)
			details.append(
				textNode(
					"p",
					`Last inventory snapshot: ${timestamp(row.lastAvailable)}`,
				),
			);
		if (!row.firstAvailable)
			details.append(
				textNode("p", "Recorded evidence only; no inventory snapshot."),
			);
		cell.append(details);
		return cell;
	}

	/** @param {UsageRow[]} rows @param {boolean} recorded @param {boolean} partial @param {string} empty */
	function drawOverview(rows, recorded, partial, empty) {
		const skills = view.value === "skills";
		const total = rows.reduce((sum, row) => sum + uses(row), 0);
		const used = rows.filter((row) => uses(row) > 0);
		const known = skills || recorded || total > 0;
		summary.replaceChildren();
		const metrics = [
			{
				label: skills
					? partial
						? "Reads found so far"
						: "Agent reads"
					: "Recorded submissions",
				value: known ? total.toLocaleString() : "Unavailable",
			},
			{
				label: skills
					? partial
						? "Skills with reads so far"
						: "Skills with reads"
					: "Commands observed",
				value: known ? used.length.toLocaleString() : "Unavailable",
			},
		];
		if (skills)
			metrics.push({
				label: "User skill submissions",
				value:
					recorded || rows.some((row) => row.submissions > 0)
						? rows
								.reduce((sum, row) => sum + row.submissions, 0)
								.toLocaleString()
						: "Unavailable",
			});
		for (const metric of metrics) {
			const node = textNode("div", "", "usage-metric");
			node.append(
				textNode("span", metric.label),
				textNode(
					"strong",
					metric.value,
					metric.value === "Unavailable" ? "metric-unavailable" : "",
				),
			);
			summary.append(node);
		}
		summary.append(
			textNode(
				"p",
				skills
					? "Agent reads include confirmed body/reference reads and inferred file reads. User submissions and continuations are separate; inventory is not a read."
					: "Observed user slash submissions only. Loaded templates and commands with no submission evidence are not usage records.",
				"usage-note muted",
			),
		);
		const heading = textNode("div", "", "chart-heading");
		heading.append(
			textNode(
				"h3",
				skills
					? partial
						? "Skill reads found so far"
						: "Agent skill reads"
					: "Recorded command submissions",
			),
			textNode(
				"span",
				used.length
					? `Top ${Math.min(CHART_LIMIT, used.length)} of ${used.length.toLocaleString()}${partial ? " so far" : ""}`
					: "",
				"muted",
			),
		);
		chart.replaceChildren(heading);
		if (!used.length) {
			chart.append(
				textNode(
					"p",
					!rows.length
						? empty
						: !known
							? "Submission counts are unavailable without recording evidence."
							: skills
								? partial
									? "No agent reads found yet. Historical scans are incomplete."
									: "No agent reads recorded in this view; this is not proof of non-use."
								: "No user submissions recorded in this view; this is not proof of non-use.",
					"chart-empty muted",
				),
			);
			return;
		}
		const ranked = used
			.sort((a, b) => uses(b) - uses(a) || a.name.localeCompare(b.name))
			.slice(0, CHART_LIMIT);
		const maximum = Math.max(...ranked.map(uses));
		const bars = textNode("ol", "", "capability-bars");
		for (const row of ranked) {
			const item = textNode("li", "", "capability-bar");
			const label = textNode("div", "", "capability-bar-heading");
			label.append(
				textNode("span", name(row), "bar-label"),
				textNode("span", uses(row).toLocaleString(), "bar-count"),
			);
			const track = textNode("span", "", "bar-track");
			track.setAttribute("aria-hidden", "true");
			const fill = textNode("span", "", "bar-fill");
			fill.style.width = `${(100 * uses(row)) / maximum}%`;
			track.append(fill);
			item.append(label, track);
			bars.append(item);
		}
		chart.append(bars);
	}

	function draw() {
		if (!latest || target.contains(document.activeElement)) return;
		const skills = view.value === "skills";
		const coverage = latest.coverage;
		for (const option of sort.options) {
			if (option.value === "most")
				option.textContent = skills ? "Most reads" : "Most submissions";
			if (option.value === "least")
				option.textContent = skills ? "Least reads" : "Least submissions";
		}
		const partial =
			skills &&
			(coverage.fileReadScan.phase !== "complete" ||
				coverage.skillResultScan.phase !== "complete");
		zero.disabled = partial || !skills;
		zeroLabel.hidden = partial || !skills;
		if (zero.disabled) zero.value = "all";
		zeroOption.textContent = "No recorded reads";
		zero.title = partial ? "Available when both historical scans finish" : "";
		partialHistory.hidden = skills && !partial;
		partialHistory.replaceChildren();
		if (partial)
			partialHistory.append(
				textNode("strong", "Partial skill history — scans are incomplete"),
				textNode(
					"p",
					`Read counts and rankings show only reads found so far. File-read scan: ${coverage.fileReadScan.phase} (${coverage.fileReadScan.progress}%). Skill-result scan: ${coverage.skillResultScan.phase} (${coverage.skillResultScan.progress}%). The no-recorded-reads filter is unavailable until both finish.`,
				),
			);
		if (!skills)
			partialHistory.append(
				textNode("strong", "Historical command usage is unavailable"),
				textNode(
					"p",
					coverage.recordingSince
						? `Recording evidence starts ${timestamp(coverage.recordingSince)} in ${coverage.recordedSessions.toLocaleString()} of ${coverage.sessions.toLocaleString()} selected sessions. Counts below cover observed submissions, not all-time usage. Pi does not retain a command log for earlier sessions.`
						: "No command recording evidence in this selection. Pi does not retain a command log that can reconstruct earlier submissions. Missing records do not mean commands were unused.",
				),
			);
		const recorded =
			coverage.recordingSince !== null && coverage.recordedSessions > 0;
		const needle = search.value.trim().toLocaleLowerCase();
		const rows = latest.rows.filter(
			(row) =>
				(skills ? row.kind === "skill" : row.submissions > 0) &&
				`${row.name} ${row.owner} ${row.path}`
					.toLocaleLowerCase()
					.includes(needle) &&
				(zero.value !== "zero" || uses(row) === 0),
		);
		rows.sort((a, b) => {
			if (sort.value === "recent")
				return (
					((skills ? b.lastRead : b.lastSubmitted) || "").localeCompare(
						(skills ? a.lastRead : a.lastSubmitted) || "",
					) || a.name.localeCompare(b.name)
				);
			if (sort.value === "name") return a.name.localeCompare(b.name);
			return (
				(sort.value === "least" ? uses(a) - uses(b) : uses(b) - uses(a)) ||
				a.name.localeCompare(b.name)
			);
		});
		element("usage-coverage").textContent = [
			...(skills
				? [
						"Agent reads only; inferred file inputs are not proof of content consumed. Hidden access is unavailable",
					]
				: [
						coverage.recordingSince
							? `Submissions since ${coverage.recordingSince.slice(0, 10)}`
							: "Submissions unavailable",
						`${coverage.recordedSessions.toLocaleString()}/${coverage.sessions.toLocaleString()} sessions have recorder evidence`,
					]),
			...(skills
				? [
						`Whole-index file-read scan: ${coverage.fileReadScan.phase} (${coverage.fileReadScan.progress}%)`,
						`Skill-result scan: ${coverage.skillResultScan.phase} (${coverage.skillResultScan.progress}%)`,
						`${coverage.fileReadScan.unresolved.toLocaleString()} potentially relevant file-read calls unattributed`,
					]
				: []),
		].join(" · ");
		element("usage-evidence-coverage").textContent =
			`Selected sessions: user submission recording since ${timestamp(coverage.recordingSince)}; ${coverage.recordedSessions.toLocaleString()} of ${coverage.sessions.toLocaleString()} sessions have recording evidence. Inventory snapshots since ${timestamp(coverage.inventorySince)} are availability, not reads. Whole-index file-read scan: ${coverage.fileReadScan.phase} (${coverage.fileReadScan.progress}%); ${coverage.fileReadScan.unresolved.toLocaleString()} potentially relevant calls could not be attributed. Skill-result scan: ${coverage.skillResultScan.phase} (${coverage.skillResultScan.progress}%). Read totals and last-read dates exclude user skill submissions and continuations. Inferred reads identify file-reading inputs, not proof that every byte was consumed. Missing read evidence is not proof of non-use.`;
		element("usage-status").textContent =
			`${rows.length.toLocaleString()} matching ${skills ? "skills" : "commands"}${partial ? " · partial read counts and rankings" : ""}${latest.truncated ? " · 500-resource limit; narrow session, project or dates for more" : ""}`;
		const empty = !skills
			? "No recorded command submissions match this selection. Historical usage is unknown."
			: latest.rows.length
				? "No resources match this view."
				: "No command or skill records in this selection.";
		drawOverview(rows, recorded, partial, empty);
		const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		page = Math.min(page, pages - 1);
		const start = page * PAGE_SIZE;
		previous.disabled = page === 0;
		next.disabled = page >= pages - 1;
		pageInfo.textContent = `Page ${page + 1} of ${pages}`;
		range.textContent = rows.length
			? `${(start + 1).toLocaleString()}–${Math.min(start + PAGE_SIZE, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`
			: "0 resources";
		if (!rows.length) {
			target.replaceChildren(textNode("p", empty, "muted"));
			return;
		}
		const expanded = new Set(
			Array.from(
				target.querySelectorAll("details[open]"),
				(node) => /** @type {HTMLElement} */ (node).dataset["resource"] || "",
			),
		);
		const table = document.createElement("table");
		const head = table.createTHead().insertRow();
		for (const heading of [
			skills ? "Skill" : "Command",
			skills
				? partial
					? "Reads so far"
					: "Agent reads"
				: "Recorded submissions",
			...(skills ? ["User skill submissions"] : []),
			skills ? "Last read (UTC)" : "Last submitted (UTC)",
		]) {
			const th = textNode("th", heading);
			th.scope = "col";
			head.append(th);
		}
		const body = table.createTBody();
		for (const item of rows.slice(start, start + PAGE_SIZE)) {
			const row = body.insertRow();
			row.append(
				resource(item, recorded, expanded),
				textNode(
					"td",
					uses(item) || skills || recorded
						? uses(item).toLocaleString()
						: "Unavailable",
					"numeric",
				),
				...(skills
					? [
							textNode(
								"td",
								item.submissions || recorded
									? item.submissions.toLocaleString()
									: "Unavailable",
								"numeric",
							),
						]
					: []),
				textNode(
					"td",
					timestamp(skills ? item.lastRead : item.lastSubmitted),
					"evidence-date",
				),
			);
		}
		target.replaceChildren(table);
	}

	/** @param {number} delta */
	function changePage(delta) {
		const focused = document.activeElement;
		page += delta;
		target.scrollTop = 0;
		draw();
		if (focused === previous && previous.disabled) next.focus();
		if (focused === next && next.disabled) previous.focus();
	}
	function resetPage() {
		page = 0;
		draw();
	}
	for (const control of [view, sort, zero])
		control.addEventListener("change", resetPage);
	search.addEventListener("input", resetPage);
	// Keep the focused disclosure/scroll region intact until focus leaves it.
	target.addEventListener("focusout", () => queueMicrotask(() => draw()));
	/** @param {UsageOverview} overview @param {string} [nextScope] */
	return function render(overview, nextScope = "") {
		if (scope !== nextScope) page = 0;
		scope = nextScope;
		latest = overview;
		draw();
	};
}
