import { parse } from "acorn";

interface Syntax {
	type: string;
	start: number;
	end: number;
	kind?: string;
	await?: boolean;
	id?: { name?: string };
	declarations?: Syntax[];
	body?: Syntax | Syntax[];
	[key: string]: unknown;
}

interface Edit { start: number; end: number; text: string }

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Hoist bindings out of a top-level await cell. Node REPL can do this, but its evaluator always loads host modules. */
export function prepareVmCell(source: string): { source: string; awaited: boolean } {
	let program: Syntax;
	try {
		program = parse(source, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, sourceType: "script" }) as unknown as Syntax;
	} catch {
		return { source, awaited: false };
	}
	if (!hasTopLevelAwait(program)) return { source, awaited: false };
	const lets: string[] = [];
	const vars: string[] = [];
	const edits: Edit[] = [];
	for (const statement of statements(program)) rewrite(statement, lets, vars, edits);
	const preamble = [
		lets.length ? `let ${unique(lets).join(", ")};` : "",
		vars.length ? `var ${unique(vars).join(", ")};` : "",
	].filter(Boolean).join("\n");
	const body = apply(source, edits);
	return { source: `${preamble}\n(async () => {\n${body}\n})()`, awaited: true };
}

function statements(program: Syntax): Syntax[] {
	const body = program["body"];
	return Array.isArray(body) ? body.filter(isSyntax) : [];
}

function rewrite(statement: Syntax, lets: string[], vars: string[], edits: Edit[]): void {
	if (statement.type === "LabeledStatement") {
		const inner = statement["body"];
		if (isSyntax(inner)) rewrite(inner, lets, vars, edits);
		return;
	}
	if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id?.name) {
		(statement.type === "FunctionDeclaration" ? vars : lets).push(statement.id.name);
		edits.push({ start: statement.start, end: statement.start, text: `${statement.id.name} = ` });
		return;
	}
	if (statement.type !== "VariableDeclaration" || !statement.declarations || !statement.kind) return;
	const names: string[] = [];
	for (const declarator of statement.declarations) names.push(...namesIn(declarator["id"]));
	(statement.kind === "var" ? vars : lets).push(...names);
	const declarators = statement.declarations;
	edits.push({
		start: statement.start,
		end: statement.start + statement.kind.length,
		text: `void${declarators.length === 1 ? "" : " ("}`,
	});
	for (const declarator of declarators) {
		edits.push({ start: declarator.start, end: declarator.start, text: "(" });
		edits.push({ start: declarator.end, end: declarator.end, text: declarator["init"] ? ")" : "=undefined)" });
	}
	if (declarators.length !== 1) {
		const last = declarators[declarators.length - 1];
		if (last) edits.push({ start: last.end, end: last.end, text: ")" });
	}
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

function hasTopLevelAwait(program: Syntax): boolean {
	let found = false;
	walk(program, 0, (node, depth) => {
		if (depth === 0 && (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true))) found = true;
	});
	return found;
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
	const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
	let out = source;
	for (const edit of ordered) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	return out;
}

function unique(names: string[]): string[] {
	return [...new Set(names)];
}

function isSyntax(value: unknown): value is Syntax {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}
