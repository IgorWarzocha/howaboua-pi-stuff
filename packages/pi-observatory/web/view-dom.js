// @ts-check
export const OUTCOMES = /** @type {const} */ ([
	["ok", "OK"],
	["error", "Errors"],
	["nonzero", "Nonzero exits"],
	["incomplete", "No final result"],
	["unknown", "Unclassified"],
]);

/** @template {keyof SVGElementTagNameMap} T @param {T} tag @param {Record<string, string | number>} [attrs] */
export function svg(tag, attrs = {}) {
	const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [name, value] of Object.entries(attrs))
		node.setAttribute(name, String(value));
	return node;
}

/** @typedef {import('../src/contracts.ts').Outcome} Outcome */

/** @param {string} id */
export function element(id) {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Missing element: ${id}`);
	return node;
}

/** @param {string} tag @param {string} text */
export function node(tag, text) {
	const n = document.createElement(tag);
	n.textContent = text;
	return n;
}

/** @param {number} value */
export function number(value) {
	return value.toLocaleString();
}

const timestampFormat = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	timeZoneName: "short",
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeZone: "UTC",
});

/** @param {string | null} value */
export function date(value) {
	if (!value) return "—";
	const time = new Date(value);
	return Number.isFinite(time.getTime()) ? timestampFormat.format(time) : value;
}

/** UTC calendar buckets must not shift when displayed in another timezone. @param {string} value */
export function dayLabel(value) {
	return dayFormat.format(new Date(`${value}T00:00:00Z`));
}

/** @param {string[]} headers @param {Array<Array<string | HTMLElement>>} rows @param {string} empty */
export function table(headers, rows, empty) {
	if (!rows.length) return node("p", empty);
	const t = document.createElement("table");
	const head = t.createTHead().insertRow();
	for (const label of headers) {
		const cell = document.createElement("th");
		cell.scope = "col";
		cell.textContent = label;
		head.append(cell);
	}
	const body = t.createTBody();
	for (const values of rows) {
		const row = body.insertRow();
		for (const value of values) {
			const cell = row.insertCell();
			if (typeof value === "string") cell.textContent = value;
			else cell.append(value);
		}
	}
	return t;
}

/** @param {string} label @param {() => void} action */
export function button(label, action) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = label;
	b.addEventListener("click", action);
	return b;
}

/** @param {Outcome} value */
export function outcomeLabel(value) {
	return {
		ok: "OK",
		error: "Error",
		nonzero: "Nonzero exit",
		incomplete: "No final result",
		unknown: "Unclassified result",
	}[value];
}
