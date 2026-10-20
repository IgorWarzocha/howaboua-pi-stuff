// @ts-check
import { element } from "./view-dom.js";

/** @typedef {import('../src/usage-query.ts').UsageRow} UsageRow */
/** @param {UsageRow} row */
function identity(row) {
	return JSON.stringify([row.kind, row.name, row.path]);
}

/** Table checkboxes retain chart selections across pages and filters. @param {() => void} changed */
export function createSkillSelection(changed) {
	const table = element("usage-table");
	const status = element("skill-selection-status");
	/** @type {Map<string, number>} */
	const selected = new Map();
	/** @type {UsageRow[]} */
	let rows = [];
	let initialised = false;

	function updateState() {
		const available = new Set(rows.map(identity));
		const hidden = [...selected.keys()].filter(
			(key) => !available.has(key),
		).length;
		status.textContent = `${selected.size}/6 selected${hidden ? ` · ${hidden} outside filters` : ""}`;
		for (const input of table.querySelectorAll("input[type=checkbox]")) {
			const checkbox = /** @type {HTMLInputElement} */ (input);
			checkbox.checked = selected.has(checkbox.value);
			checkbox.disabled = !checkbox.checked && selected.size >= 6;
		}
	}
	element("skill-selection-clear").addEventListener("click", () => {
		initialised = true;
		selected.clear();
		updateState();
		changed();
	});
	return {
		/** @param {UsageRow} row */
		checkbox(row) {
			const key = identity(row);
			const input = document.createElement("input");
			input.type = "checkbox";
			input.value = key;
			input.checked = selected.has(key);
			input.disabled = !input.checked && selected.size >= 6;
			input.setAttribute(
				"aria-label",
				`Compare ${row.name}${row.path ? ` (${row.path})` : ""}`,
			);
			input.addEventListener("change", () => {
				initialised = true;
				if (input.checked && selected.size < 6) {
					const used = new Set(selected.values());
					const slot = [0, 1, 2, 3, 4, 5].find((value) => !used.has(value));
					if (slot !== undefined) selected.set(key, slot);
				} else selected.delete(key);
				updateState();
				changed();
			});
			return input;
		},
		/** @param {UsageRow[]} next */
		render(next) {
			rows = next;
			if (!initialised && rows.length) {
				const ranked = rows
					.filter((row) => row.daily.some((day) => day.agent || day.user))
					.sort(
						(a, b) =>
							b.skillReads +
							b.referenceReads +
							b.fileReads +
							b.fileReferenceReads -
							(a.skillReads +
								a.referenceReads +
								a.fileReads +
								a.fileReferenceReads),
					);
				initialised = ranked.length > 0;
				for (const [slot, row] of ranked.slice(0, 3).entries())
					selected.set(identity(row), slot);
			}
			updateState();
		},
		selection() {
			const available = new Map(rows.map((row) => [identity(row), row]));
			const active = [...selected].flatMap(([key, slot]) => {
				const row = available.get(key);
				return row ? [{ key, row, slot }] : [];
			});
			return active.map((item) => ({
				...item,
				label: active.some(
					(other) => other.row.name === item.row.name && other.key !== item.key,
				)
					? `${item.row.name} (${item.row.path || item.row.owner})`
					: item.row.name,
			}));
		},
	};
}
