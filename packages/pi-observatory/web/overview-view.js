// @ts-check
import { activityChart, dailySeries } from "./activity-chart.js";
import { outcomeChart, usageChart } from "./charts.js";
import { button, date, element, node, number, table } from "./view-dom.js";

/** @typedef {import('../src/contracts.ts').Counts} Counts */
/** @typedef {import('../src/contracts.ts').Outcome} Outcome */
/** @typedef {import('../src/contracts.ts').OutcomeGroup} OutcomeGroup */
/** @typedef {import('../src/contracts.ts').Overview} Overview */
/** @typedef {import('../src/contracts.ts').IndexStatus} IndexStatus */

/** @param {Counts} count */
function completed(count) {
	return count.ok + count.error + count.nonzero;
}

/** @param {number} value @param {number} total */
function rate(value, total) {
	if (!total) return "—";
	const percentage = (100 * value) / total;
	return percentage > 0 && percentage < 0.1
		? "<0.1%"
		: `${percentage.toFixed(1)}%`;
}

const primaryHeaders = ["Calls", "Share", "Errors"];

/** @param {Counts} c @param {number} total */
function primaryCells(c, total) {
	return [number(c.calls), rate(c.calls, total), number(c.error)];
}

/** @param {(selection: Record<string, string>, result?: Outcome | "all") => void} selectCalls @param {() => URLSearchParams} getQuery */
export function createOverviewView(selectCalls, getQuery) {
	/** @type {Overview | undefined} */ let latestOverview;
	/** @type {ReturnType<typeof dailySeries> | undefined} */ let activityDays;

	/** @param {OutcomeGroup[]} groups @param {"error" | "nonzero"} result */
	function patternTable(groups, result) {
		return table(
			["Tool", "Model", "Message", "Count", "Last seen"],
			groups.map((g) => [
				g.tool,
				`${g.provider} / ${g.model}`,
				button(g.signature || "(empty message)", () =>
					selectCalls(
						{
							tool: g.tool,
							provider: g.provider,
							model: g.model,
							signature: g.signature,
						},
						result,
					),
				),
				number(g.count),
				date(g.lastSeen),
			]),
			result === "error" ? "No errors." : "No nonzero exits.",
		);
	}

	/** @param {string} id @param {Node[]} content */
	function replaceOverview(id, ...content) {
		const target = element(id);
		if (!target.contains(document.activeElement))
			target.replaceChildren(...content);
	}

	function renderActivity() {
		if (!activityDays) return;
		const plot = element("activity-plot");
		if (plot.contains(document.activeElement)) return;
		plot.replaceChildren(
			activityChart(activityDays, plot.clientWidth, (day, result) =>
				selectCalls({ since: day, until: day }, result),
			),
		);
	}

	/** @param {Overview} overview */
	function renderOverview(overview) {
		latestOverview = overview;
		const c = overview.totals;
		replaceOverview(
			"totals",
			.../** @type {const} */ ([
				[
					"Total calls",
					number(c.calls),
					getQuery().get("scope") === "direct"
						? "Direct calls"
						: getQuery().get("scope") === "nested"
							? "Nested calls"
							: getQuery().get("scope") === "model"
								? "Model operations"
								: "Tools + model operations",
					"all",
				],
				[
					"Errors",
					number(c.error),
					completed(c) ? rate(c.error, completed(c)) : "",
					"error",
				],
				["Nonzero exits", number(c.nonzero), "", "nonzero"],
				["No final result", number(c.incomplete), "", "incomplete"],
			]).map(([label, value, detail, result]) => {
				const metric = button("", () => selectCalls({}, result));
				metric.className = "metric";
				metric.append(node("span", label), node("strong", value));
				if (detail) metric.append(node("small", detail));
				return metric;
			}),
		);
		replaceOverview(
			"outcome-chart",
			outcomeChart(c, (result) => selectCalls({}, result)),
		);
		const modelItems = overview.byModel.map((row) => ({
			...row,
			label: `${row.provider} / ${row.model}`,
			select: () =>
				selectCalls({
					provider: row.provider,
					model: row.model,
					signature: "",
				}),
		}));
		const toolItems = overview.byTool.map((row) => ({
			...row,
			label: row.tool,
			select: () => selectCalls({ tool: row.tool, signature: "" }),
		}));
		replaceOverview("tool-chart", usageChart(toolItems.slice(0, 6), c.calls));
		replaceOverview("model-chart", usageChart(modelItems.slice(0, 6), c.calls));
		const modelRows = modelItems.map((row) => [
			button(row.label, row.select),
			...primaryCells(row, c.calls),
		]);
		const toolRows = toolItems.map((row) => [
			button(row.label, row.select),
			...primaryCells(row, c.calls),
		]);
		replaceOverview(
			"models",
			table(["Model", ...primaryHeaders], modelRows, "No calls."),
		);
		replaceOverview(
			"tools",
			table(["Operation", ...primaryHeaders], toolRows, "No calls."),
		);
		activityDays = dailySeries(overview.daily);
		renderActivity();
		replaceOverview("groups", patternTable(overview.groups, "error"));
		element("errors-summary").textContent = `Errors · ${number(c.error)}`;
		replaceOverview("exits", patternTable(overview.exits, "nonzero"));
		element("exits-summary").textContent = c.nonzero
			? `Nonzero exits · ${number(c.nonzero)}`
			: "Nonzero exits";
	}

	/** @param {IndexStatus} status */
	function renderStatus(status) {
		const messages = [
			...(status.error ? [status.error] : []),
			...status.issues.map((i) => `${i.path}: ${i.message}`),
		];
		const label = messages.length
			? "Index needs attention"
			: status.phase === "idle"
				? "Index up to date"
				: `Index: ${status.phase}`;
		element("index-status-detail").textContent =
			`${label} · ${number(status.files)} files · ${number(status.entries)} entries${status.lastScan ? ` · scanned ${date(status.lastScan)}` : ""}`;
		const c = status.coverage;
		const gaps = /** @type {Array<[number, string]>} */ ([
			[c.wrappersWithoutTraces, "wrappers without traces"],
			[c.droppedTraces, "dropped traces"],
			[c.malformedLines, "malformed lines"],
			[c.unpairedResults, "unpaired results"],
			[c.nativeIncomplete, "incomplete native-call records"],
			[c.uncorrelatedNativeOmitted, "uncorrelated native calls omitted"],
			[c.unreadableCachedResults, "unreadable cached results"],
			[c.unmatchedObservations, "live observations awaiting exact correlation"],
		]).filter(([count]) => count > 0);
		element("coverage-counts").replaceChildren(
			...gaps.flatMap(([count, label]) => [
				node("dt", label),
				node("dd", number(count)),
			]),
		);
		element("coverage-indicator").textContent = messages.length
			? `${messages.length} ${messages.length === 1 ? "issue" : "issues"}`
			: "";
		const list = element("index-issues");
		if (list.textContent !== messages.join("")) {
			list.replaceChildren(...messages.map((m) => node("li", m)));
			if (messages.length)
				/** @type {HTMLDetailsElement} */ (element("coverage")).open = true;
		}
	}

	/** @param {FocusEvent} event */
	function onOverviewFocusOut(event) {
		if (
			event.relatedTarget instanceof Node &&
			element("overview").contains(event.relatedTarget)
		)
			return;
		queueMicrotask(() => {
			if (
				latestOverview &&
				!element("overview").contains(document.activeElement)
			)
				renderOverview(latestOverview);
		});
	}
	element("overview").addEventListener("focusout", onOverviewFocusOut);
	let activityWidth = 0;
	const chartResize = new ResizeObserver(([entry]) => {
		const width = Math.floor(entry?.contentRect.width ?? 0);
		if (width === activityWidth) return;
		activityWidth = width;
		renderActivity();
	});
	chartResize.observe(element("activity-plot"));

	function dispose() {
		element("overview").removeEventListener("focusout", onOverviewFocusOut);
		chartResize.disconnect();
		latestOverview = undefined;
		activityDays = undefined;
	}

	return { render: renderOverview, renderActivity, renderStatus, dispose };
}
