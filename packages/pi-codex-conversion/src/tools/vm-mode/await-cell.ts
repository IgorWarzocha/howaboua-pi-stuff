import { parse } from "acorn";

interface Syntax {
	type: string;
	start: number;
	end: number;
	kind?: string;
	await?: boolean;
	directive?: string;
	declarations?: Syntax[];
	body?: Syntax | Syntax[];
	[key: string]: unknown;
}

interface Edit { start: number; end: number; text: string }

export interface VmStep { async: boolean; source: string }
export type VmPlan = { awaited: false; source: string } | { awaited: true; steps: VmStep[] };

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const INIT = `globalThis[Symbol.for("pi.vm-code/init")]`;

/** Split an awaited cell into scripts that keep the same bindings as a normal cell. Node REPL is not used: its evaluator loads host modules. */
export function planVmCell(source: string): VmPlan {
	let program: Syntax;
	try {
		program = parse(source, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, sourceType: "script" }) as unknown as Syntax;
	} catch {
		return { awaited: false, source };
	}
	if (!containsAwait(program)) return { awaited: false, source };
	const body = statements(program);
	const strict = body[0]?.directive === "use strict" ? `"use strict";\n` : "";
	const preamble = preambleSource(program, source);
	const steps: VmStep[] = [];
	if (preamble) steps.push({ async: false, source: `${strict}${preamble}` });
	for (const statement of body) steps.push(...stepsFor(statement, source, strict));
	return { awaited: true, steps };
}

function stepsFor(statement: Syntax, source: string, strict: string): VmStep[] {
	if (statement.type === "FunctionDeclaration") return [];
	if (statement.type === "VariableDeclaration" && statement.kind !== "var" && statement.declarations && containsAwait(statement)) {
		return statement.declarations.flatMap(declarator => lexicalSteps(statement.kind ?? "let", declarator, source, strict));
	}
	const text = statement.type === "VariableDeclaration" && statement.kind === "var" && containsAwait(statement)
		? withoutVar(statement, source)
		: containsAwait(statement) ? withoutVar(statement, source) : slice(statement, source);
	if (!text.trim()) return [];
	if (!containsAwait(statement)) return [{ async: false, source: `${strict}${text}` }];
	return [{ async: true, source: `${strict}(async () => {\n${text}\n})()` }];
}

function lexicalSteps(kind: string, declarator: Syntax, source: string, strict: string): VmStep[] {
	const id = declarator["id"];
	const names = namesIn(id);
	if (!isSyntax(id) || names.length === 0) return [];
	const init = declarator["init"];
	const initializer = isSyntax(init) ? slice(init, source) : "undefined";
	const puts = names.map(name => `${INIT}.put(${name});`).join("\n");
	const bindings = names.map(name => `${name} = ${INIT}.take()`).join(", ");
	return [
		{ async: true, source: `${strict}(async () => {\n${kind} ${slice(id, source)} = ${initializer};\n${puts}\n})()` },
		{ async: false, source: `${strict}${kind} ${bindings};` },
	];
}

function preambleSource(program: Syntax, source: string): string {
	const vars: string[] = [];
	const functions: string[] = [];
	for (const statement of statements(program)) {
		if (statement.type === "FunctionDeclaration") functions.push(slice(statement, source));
	}
	walk(program, 0, (node, depth) => {
		if (depth === 0 && node.type === "VariableDeclaration" && node.kind === "var") {
			for (const declarator of node.declarations ?? []) vars.push(...namesIn(declarator["id"]));
		}
	});
	return [
		vars.length ? `var ${unique(vars).join(", ")};` : "",
		...functions,
	].filter(Boolean).join("\n");
}

function withoutVar(statement: Syntax, source: string): string {
	const edits: Edit[] = [];
	walk(statement, 0, (node, depth) => {
		if (depth !== 0 || node.type !== "VariableDeclaration" || node.kind !== "var" || !node.declarations) return;
		const declarators = node.declarations;
		edits.push({ start: node.start, end: node.start + node.kind.length, text: `void${declarators.length === 1 ? "" : " ("}` });
		for (const declarator of declarators) {
			if (declarator["init"]) {
				edits.push({ start: declarator.start, end: declarator.start, text: "(" });
				edits.push({ start: declarator.end, end: declarator.end, text: ")" });
			} else {
				edits.push({ start: declarator.start, end: declarator.end, text: "(void 0)" });
			}
		}
		if (declarators.length !== 1) {
			const last = declarators[declarators.length - 1];
			if (last) edits.push({ start: last.end, end: last.end, text: ")" });
		}
	});
	const base = statement.start;
	return apply(slice(statement, source), edits.map(edit => ({ start: edit.start - base, end: edit.end - base, text: edit.text })));
}

function containsAwait(node: Syntax): boolean {
	let found = false;
	walk(node, 0, (child, depth) => {
		if (depth === 0 && (child.type === "AwaitExpression" || (child.type === "ForOfStatement" && child.await === true))) found = true;
	});
	return found;
}

function statements(program: Syntax): Syntax[] {
	const body = program["body"];
	return Array.isArray(body) ? body.filter(isSyntax) : [];
}

function namesIn(pattern: unknown): string[] {
	if (!isSyntax(pattern)) return [];
	if (pattern.type === "Identifier" && pattern["name"]) return [String(pattern["name"])];
	if (pattern.type === "RestElement") return namesIn(pattern["argument"]);
	if (pattern.type === "AssignmentPattern") return namesIn(pattern["left"]);
	if (pattern.type === "ObjectPattern" && Array.isArray(pattern["properties"])) {
		return pattern["properties"].flatMap(property => isSyntax(property) && property.type === "Property" ? namesIn(property["value"]) : namesIn(property));
	}
	if (pattern.type === "ArrayPattern" && Array.isArray(pattern["elements"])) return pattern["elements"].flatMap(namesIn);
	return [];
}

function walk(node: Syntax, depth: number, visit: (node: Syntax, depth: number) => void): void {
	visit(node, depth);
	const next = FUNCTION.has(node.type) ? depth + 1 : depth;
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const item of value) if (isSyntax(item)) walk(item, next, visit);
		} else if (isSyntax(value)) walk(value, next, visit);
	}
}

function apply(source: string, edits: Edit[]): string {
	let out = source;
	for (const edit of [...edits].sort((left, right) => right.start - left.start || right.end - left.end)) {
		out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	}
	return out;
}

function slice(node: Syntax, source: string): string {
	return source.slice(node.start, node.end);
}

function unique(names: string[]): string[] {
	return [...new Set(names)];
}

function isSyntax(value: unknown): value is Syntax {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}
