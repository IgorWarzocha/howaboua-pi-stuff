// @ts-check
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

/** @param {string} value */
export function date(value) {
	return value ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "—";
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
