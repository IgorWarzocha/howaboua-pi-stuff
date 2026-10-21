// @ts-check
import { createUsageTimeline } from "./usage-timeline.js";
import { element, date as timestamp } from "./view-dom.js";

/** @typedef {import('../src/usage-query.ts').UsageRow} UsageRow */
/** @typedef {import('../src/usage-query.ts').UsageOverview} UsageOverview */

const PAGE_SIZE = 10;

/** @template {keyof HTMLElementTagNameMap} T @param {T} tag @param {string} text @param {string} [className] */
function textNode(tag, text, className) {
	const node = document.createElement(tag);
	node.textContent = text;
	if (className) node.className = className;
	return node;
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

/** User command submissions and agent skill reads intentionally have separate views. @param {(day: string) => void} selectDay */
export function createUsageView(selectDay) {
	const timeline = createUsageTimeline(selectDay);
	const view = /** @type {HTMLSelectElement} */ (element("usage-view"));
	const search = /** @type {HTMLInputElement} */ (element("usage-search"));
	const sort = /** @type {HTMLSelectElement} */ (element("usage-sort"));
	const zero = /** @type {HTMLSelectElement} */ (element("usage-zero"));
	const zeroOption = element("usage-zero-option");
	const zeroLabel = element("usage-zero-label");
	const target = element("usage-table");
	const summary = element("usage-summary");
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

	/** @param {UsageRow} row */
	function resource(row) {
		const cell = document.createElement("td");
		const title = textNode("strong", name(row), "capability-name");
		if (view.value === "skills") {
			const label = document.createElement("label");
			label.className = "skill-choice";
			label.append(timeline.checkbox(row), title);
			cell.append(label);
		} else {
			cell.append(title);
			cell.append(textNode("span", row.kind, "muted capability-kind"));
		}
		return cell;
	}

	/** @param {UsageRow[]} rows @param {boolean} recorded */
	function drawSummary(rows, recorded) {
		const skills = view.value === "skills";
		const total = rows.reduce((sum, row) => sum + uses(row), 0);
		const used = rows.filter((row) => uses(row) > 0).length;
		const activity = skills
			? total === 1
				? "read"
				: "reads"
			: total === 1
				? "submission"
				: "submissions";
		const resources = skills
			? used === 1
				? "skill"
				: "skills"
			: used === 1
				? "command"
				: "commands";
		summary.textContent =
			!skills && !recorded && total === 0
				? "Submission counts unavailable"
				: `${total.toLocaleString()} ${activity} · ${used.toLocaleString()} ${resources}`;
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
		zero.title = partial ? "History scan in progress" : "";
		partialHistory.hidden = !partial;
		partialHistory.textContent = partial
			? coverage.fileReadScan.pending
				? `Skill history needs rebuilding (${coverage.fileReadScan.pending.toLocaleString()} calls pending). Counts are partial. Update once or enable live monitoring to finish.`
				: `History scan incomplete (${Math.min(coverage.fileReadScan.progress, coverage.skillResultScan.progress)}%). Counts are partial. Update once or enable live monitoring to finish.`
			: "";
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
			...(!skills
				? [
						coverage.recordingSince
							? `Recording since ${timestamp(coverage.recordingSince)}`
							: "No recording evidence",
						`${coverage.recordedSessions.toLocaleString()}/${coverage.sessions.toLocaleString()} sessions have recorder evidence`,
					]
				: []),
			...(skills
				? [
						`Whole-index file-read scan: ${coverage.fileReadScan.phase} (${coverage.fileReadScan.progress}%)`,
						`Skill-result scan: ${coverage.skillResultScan.phase} (${coverage.skillResultScan.progress}%)`,
						`${coverage.fileReadScan.unresolved.toLocaleString()} potentially relevant file-read calls unattributed`,
					]
				: []),
		].join(" · ");
		const empty = !skills
			? recorded
				? "No recorded command submissions match this selection."
				: "No command recording evidence in this selection. Earlier usage is unknown."
			: partial
				? "Skill history is incomplete. Counts are not final."
				: latest.rows.some((row) => row.kind === "skill")
					? "No skills match this selection."
					: "No skill records in this selection.";
		drawSummary(rows, recorded);
		timeline.render(rows, skills, empty);
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
		const table = document.createElement("table");
		const head = table.createTHead().insertRow();
		for (const heading of [
			skills ? "Skill" : "Command",
			skills ? "Agent" : "User",
			...(skills ? ["User"] : []),
			skills ? "Last read" : "Last submitted",
			"Source",
		]) {
			const th = textNode("th", heading);
			th.scope = "col";
			head.append(th);
		}
		const body = table.createTBody();
		for (const item of rows.slice(start, start + PAGE_SIZE)) {
			const row = body.insertRow();
			row.append(
				resource(item),
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
				textNode(
					"td",
					[item.owner, item.path].filter(Boolean).join("\n") || "—",
					"source-path",
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
	// Keep the focused scroll region intact until focus leaves it.
	target.addEventListener("focusout", (event) => {
		if (
			event.relatedTarget instanceof Node &&
			target.contains(event.relatedTarget)
		)
			return;
		queueMicrotask(() => draw());
	});
	/** @param {UsageOverview} overview @param {string} [nextScope] */
	function render(overview, nextScope = "") {
		if (scope !== nextScope) page = 0;
		scope = nextScope;
		latest = overview;
		draw();
	}
	return { render, dispose: timeline.dispose };
}
