// @ts-check
import { element } from "./view-dom.js";

/** @typedef {import('../src/usage-query.ts').UsageRow} UsageRow */
/** @param {UsageRow} row */
function identity(row) {
	return JSON.stringify([row.kind, row.name, row.path]);
}

/** Chart selection is independent of table pagination and picker search. @param {() => void} changed */
export function createSkillSelection(changed) {
	const target = element("skill-selection");
	const search = /** @type {HTMLInputElement} */ (element("skill-search"));
	const list = element("skill-options");
	const summary = element("skill-selection-summary");
	const status = element("skill-selection-status");
	/** @type {Map<string, {row: UsageRow, slot: number}>} */
	const selected = new Map();
	/** @type {UsageRow[]} */
	let rows = [];
	let initialised = false;

	function updateState() {
		summary.textContent = `Skills · ${selected.size} selected`;
		const available = new Set(rows.map(identity));
		const hidden = [...selected.keys()].filter(
			(key) => !available.has(key),
		).length;
		status.textContent = `${selected.size}/6 selected${hidden ? ` · ${hidden} outside current filters` : ""}`;
		for (const input of list.querySelectorAll("input")) {
			input.checked = selected.has(input.value);
			input.disabled = !input.checked && selected.size >= 6;
		}
	}

	function drawOptions() {
		if (list.contains(document.activeElement)) return;
		const available = new Set(rows.map(identity));
		const choices = new Map(rows.map((row) => [identity(row), row]));
		for (const [key, { row }] of selected) choices.set(key, row);
		const needle = search.value.trim().toLocaleLowerCase();
		const options = [...choices.values()]
			.filter((row) =>
				`${row.name} ${row.owner} ${row.path}`
					.toLocaleLowerCase()
					.includes(needle),
			)
			.sort(
				(a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
			);
		list.replaceChildren();
		for (const row of options) {
			const key = identity(row);
			const label = document.createElement("label");
			const input = document.createElement("input");
			input.type = "checkbox";
			input.value = key;
			const text = document.createElement("span");
			const name = document.createElement("strong");
			name.textContent = row.name;
			const source = document.createElement("small");
			source.textContent = [
				row.path || row.owner,
				!available.has(key) ? "Outside current filters" : "",
			]
				.filter(Boolean)
				.join(" · ");
			text.append(name, source);
			label.append(input, text);
			input.addEventListener("change", () => {
				initialised = true;
				if (input.checked && selected.size < 6) {
					const used = new Set([...selected.values()].map((item) => item.slot));
					const slot = [0, 1, 2, 3, 4, 5].find((value) => !used.has(value));
					if (slot !== undefined)
						selected.set(key, {
							row: rows.find((current) => identity(current) === key) ?? row,
							slot,
						});
				} else selected.delete(key);
				updateState();
				changed();
			});
			list.append(label);
		}
		if (!options.length) list.textContent = "No matching skills.";
		updateState();
	}
	search.addEventListener("input", drawOptions);
	element("skill-selection-clear").addEventListener("click", () => {
		initialised = true;
		selected.clear();
		drawOptions();
		changed();
	});
	target.addEventListener("focusout", (event) => {
		if (
			event.relatedTarget instanceof Node &&
			target.contains(event.relatedTarget)
		)
			return;
		queueMicrotask(drawOptions);
	});
	return {
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
					selected.set(identity(row), { row, slot });
			}
			for (const row of rows) {
				const item = selected.get(identity(row));
				if (item) item.row = row;
			}
			drawOptions();
		},
		selection() {
			const available = new Set(rows.map(identity));
			const active = [...selected].filter(([key]) => available.has(key));
			return active.map(([key, { row, slot }]) => ({
				key,
				row,
				slot,
				label: active.some(
					([otherKey, other]) =>
						other.row.name === row.name && otherKey !== key,
				)
					? `${row.name} (${row.path || row.owner})`
					: row.name,
			}));
		},
	};
}
