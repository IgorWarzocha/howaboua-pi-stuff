// @ts-check

/** @typedef {import('../src/usage.ts').UsageRow} UsageRow */
/** @typedef {import('../src/usage.ts').UsageOverview} UsageOverview */

/** @param {string} tag @param {string} text @param {string} [className] */
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

/** Command counts and skill-read evidence intentionally have separate views. */
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
	const target = element("usage-table");
	/** @type {UsageOverview | undefined} */
	let latest;

	/** @param {UsageRow} row */
	function uses(row) {
		return view.value === "skills"
			? row.skillReads +
					row.referenceReads +
					row.continuations +
					row.submissions
			: row.submissions;
	}

	/** @param {UsageRow} row */
	function resource(row) {
		const cell = document.createElement("td");
		const name =
			view.value === "skills"
				? row.name
				: `/${row.kind === "skill" ? "skill:" : ""}${row.name}`;
		cell.append(textNode("strong", name, "capability-name"));
		if (view.value !== "skills")
			cell.append(textNode("span", row.kind, "muted capability-kind"));
		if (row.path || row.firstAvailable || row.lastAvailable) {
			const source = document.createElement("details");
			source.append(textNode("summary", row.owner || "Source & availability"));
			if (row.path) source.append(textNode("p", row.path, "source-path"));
			if (row.firstAvailable)
				source.append(
					textNode("p", `First available ${timestamp(row.firstAvailable)}`),
				);
			if (row.lastAvailable)
				source.append(
					textNode("p", `Last available ${timestamp(row.lastAvailable)}`),
				);
			cell.append(source);
		} else if (row.owner)
			cell.append(textNode("span", row.owner, "muted capability-kind"));
		return cell;
	}

	function draw() {
		if (!latest) return;
		const skills = view.value === "skills";
		const recorded =
			latest.coverage.recordingSince !== null &&
			latest.coverage.recordedSessions > 0;
		const needle = search.value.trim().toLocaleLowerCase();
		const rows = latest.rows.filter(
			(row) =>
				(skills
					? row.kind === "skill"
					: row.kind !== "skill" ||
						row.firstAvailable !== null ||
						row.submissions > 0) &&
				`${row.name} ${row.owner} ${row.path}`
					.toLocaleLowerCase()
					.includes(needle) &&
				(zero.value !== "zero" || (uses(row) === 0 && (skills || recorded))),
		);
		rows.sort((a, b) => {
			if (sort.value === "recent")
				return (
					((skills ? b.lastUsed : b.lastSubmitted) || "").localeCompare(
						(skills ? a.lastUsed : a.lastSubmitted) || "",
					) || a.name.localeCompare(b.name)
				);
			if (sort.value === "name") return a.name.localeCompare(b.name);
			return (
				(sort.value === "least" ? uses(a) - uses(b) : uses(b) - uses(a)) ||
				a.name.localeCompare(b.name)
			);
		});
		const coverage = latest.coverage;
		element("usage-coverage").textContent = [
			coverage.recordingSince
				? `Submissions since ${coverage.recordingSince.slice(0, 10)}`
				: "Submissions unavailable",
			`${coverage.recordedSessions.toLocaleString()}/${coverage.sessions.toLocaleString()} sessions recorded`,
			coverage.inventorySince
				? `Inventory since ${coverage.inventorySince.slice(0, 10)}`
				: "No inventory snapshots",
		].join(" · ");
		element("usage-evidence-coverage").textContent =
			`Selected sessions: submission recording since ${timestamp(coverage.recordingSince)}; ${coverage.recordedSessions.toLocaleString()} of ${coverage.sessions.toLocaleString()} sessions have recording evidence. Inventory snapshots since ${timestamp(coverage.inventorySince)}.`;
		element("usage-status").textContent =
			`${rows.length.toLocaleString()} ${skills ? (rows.length === 1 ? "skill" : "skills") : rows.length === 1 ? "command" : "commands"}${latest.truncated ? " · 500-resource limit; narrow session, project or dates for more" : ""}`;
		// Defer refreshed rows while a source disclosure or scroll region has focus.
		if (target.contains(document.activeElement)) return;
		if (!rows.length) {
			target.replaceChildren(
				textNode(
					"p",
					latest.rows.length
						? zero.value === "zero" && !skills && !recorded
							? "Zero-submission counts are unavailable without recording evidence."
							: "No matching recorded resources."
						: "No command or skill records in this selection.",
				),
			);
			return;
		}
		const table = document.createElement("table");
		const head = table.createTHead().insertRow();
		const headings = [
			skills ? "Skill" : "Command",
			...(skills ? ["Body reads", "Reference reads", "Continuations"] : []),
			"Submissions",
			skills ? "Last used (UTC)" : "Last submitted (UTC)",
			"Available since",
		];
		for (const heading of headings) {
			const th = document.createElement("th");
			th.scope = "col";
			th.textContent = heading;
			head.append(th);
		}
		const body = table.createTBody();
		for (const item of rows) {
			const row = body.insertRow();
			row.append(resource(item));
			for (const count of skills
				? [item.skillReads, item.referenceReads, item.continuations]
				: [])
				row.append(textNode("td", count.toLocaleString(), "numeric"));
			row.append(
				textNode(
					"td",
					item.submissions || recorded
						? item.submissions.toLocaleString()
						: "Unavailable",
					"numeric",
				),
			);
			row.append(
				textNode(
					"td",
					timestamp(skills ? item.lastUsed : item.lastSubmitted),
					"evidence-date",
				),
			);
			const inventory = row.insertCell();
			inventory.textContent = item.firstAvailable
				? item.firstAvailable.slice(0, 10)
				: "Observed only";
		}
		target.replaceChildren(table);
	}

	for (const control of [view, sort, zero])
		control.addEventListener("change", draw);
	search.addEventListener("input", draw);
	target.addEventListener("focusout", () =>
		queueMicrotask(() => {
			if (!target.contains(document.activeElement)) draw();
		}),
	);
	/** @param {UsageOverview} overview */
	return function render(overview) {
		latest = overview;
		draw();
	};
}
