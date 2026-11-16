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

export interface VmBindings { lexical: string[]; vars: string[]; functions: string[] }
export type VmPlan = { awaited: false; source: string } | ({ awaited: true; segments: string[]; publish: boolean } & VmBindings);

const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const LOOP = new Set(["ForStatement", "ForInStatement", "ForOfStatement"]);
const HOST = `globalThis[Symbol.for("pi.vm-code/init")]`;
const SLOT = `${HOST}.slot()`;

/**
 * A function keeps the context binding it closes over. Cells that close over a `let`, `const`
 * or class declared in that cell run as scripts in the context. Other awaited cells run as one
 * async function so a temporal-dead-zone throw does not leave the name stuck on the context.
 */
export function planVmCell(source: string): VmPlan {
	let program: Syntax;
	try {
		program = parse(source, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, sourceType: "script" }) as unknown as Syntax;
	} catch (error) {
		if (declaredEarly(error)) throw error;
		return { awaited: false, source };
	}
	if (!containsAwait(program)) return { awaited: false, source };
	const body = statements(program);
	const bindings = scriptBindings(program);
	if (captures(program, bindings.lexical)) return { awaited: true, segments: compileSegments(body, source, bindings), publish: false, ...bindings };
	return { awaited: true, segments: [compileWrapper(body, source, bindings)], publish: true, ...bindings };
}

function captures(program: Syntax, names: string[]): boolean {
	const wanted = new Set(names);
	if (!wanted.size) return false;
	let found = false;
	walk(program, 0, (node, depth) => {
		if (depth > 0 && node.type === "Identifier" && wanted.has(String(node["name"] ?? ""))) found = true;
	});
	return found;
}

function compileWrapper(body: Syntax[], source: string, bindings: VmBindings): string {
	const strict = body[0]?.directive === "use strict" ? `"use strict";\n` : "";
	const functions = bindings.functions.flatMap(name => [
		`${HOST}.publish("function",${JSON.stringify(name)},${name});`,
		remember("function", name),
	]).join("\n");
	const rendered = body.flatMap(statement => statement.directive === "use strict" ? [] : renderStatement(statement, source)).join("\n");
	return `(async () => {\n${strict}${functions}\ntry {\n${rendered}\n} finally {\n${HOST}.flush();\n}\n})()`;
}

function renderStatement(statement: Syntax, source: string): string[] {
	if (statement.type === "FunctionDeclaration") return [slice(statement, source)];
	if (statement.type === "ClassDeclaration") {
		const name = namesIn(statement["id"])[0];
		return [slice(statement, source), ...(name ? [remember("class", name)] : [])];
	}
	if (statement.type === "VariableDeclaration" && (statement.kind === "let" || statement.kind === "const")) return renderLexical(statement.kind, statement, source);
	return [rewriteVars(statement, source)];
}

function renderLexical(kind: string, statement: Syntax, source: string): string[] {
	const declarators = statement.declarations ?? [];
	const names = declarators.flatMap(declarator => namesIn(declarator["id"]));
	const simple = declarators.every(declarator => isSyntax(declarator["id"]) && declarator["id"].type === "Identifier");
	const readers = names.map(name => remember(kind, name));
	if (!simple) return [slice(statement, source), ...readers];
	const parts = declarators.map(declarator => {
		const id = declarator["id"];
		if (!isSyntax(id) || id.type !== "Identifier") return slice(declarator, source);
		const name = String(id["name"]);
		const init = declarator["init"];
		const expr = isSyntax(init) ? slice(init, source) : "undefined";
		return `${slice(id, source)} = ${HOST}.publish(${JSON.stringify(kind)},${JSON.stringify(name)},(${expr}))`;
	});
	return [`${kind} ${parts.join(", ")};`, ...readers];
}

function remember(kind: string, name: string): string {
	return `${HOST}.read(() => ${HOST}.publish(${JSON.stringify(kind)},${JSON.stringify(name)},${name}));`;
}

function compileSegments(body: Syntax[], source: string, bindings: VmBindings): string[] {
	const strict = body[0]?.directive === "use strict";
	const functions = body.filter(statement => statement.type === "FunctionDeclaration").map(statement => slice(statement, source));
	const segments: string[][] = [];
	let current = prologue(true);
	let open = true;

	function prologue(first: boolean): string[] {
		const lines: string[] = [];
		if (strict) lines.push(`"use strict";`);
		if (first && bindings.vars.length) lines.push(`var ${bindings.vars.join(", ")};`);
		if (first && functions.length) lines.push(functions.join("\n"));
		return lines;
	}
	function emit(line: string): void {
		if (!open) current = prologue(false);
		open = true;
		current.push(line);
	}
	function finish(expression?: string): void {
		if (expression) emit(`;${expression}`);
		if (current.some(line => line !== `"use strict";`)) segments.push(current);
		current = [];
		open = false;
	}

	for (const statement of body) {
		if (statement.directive === "use strict" || statement.type === "FunctionDeclaration") continue;
		if (!containsAwait(statement)) {
			emit(slice(statement, source));
			continue;
		}
		if (statement.type === "VariableDeclaration") emitVariable(statement);
		else if (statement.type === "ClassDeclaration") emitClass(statement);
		else if (statement.type === "ExpressionStatement" && isSyntax(statement["expression"])) finish(`(async () => (${slice(statement["expression"], source)}))()`);
		else finish(`(async () => {\n${rewriteVars(statement, source)}\n})()`);
	}
	finish();
	return segments.map(lines => lines.join("\n"));

	function emitVariable(statement: Syntax): void {
		const kind = statement.kind ?? "let";
		for (const declarator of statement.declarations ?? []) {
			const id = declarator["id"];
			const init = declarator["init"];
			if (!isSyntax(id)) continue;
			if (containsAwait(id)) {
				emitPattern(kind, id, isSyntax(init) ? init : undefined);
				continue;
			}
			if (isSyntax(init) && containsAwait(init)) {
				finish(`(async () => (${slice(init, source)}))()`);
				emit(`${kind} ${slice(id, source)} = ${SLOT};`);
				continue;
			}
			emit(`${kind} ${slice(declarator, source)};`);
		}
	}

	function emitPattern(kind: string, id: Syntax, init: Syntax | undefined): void {
		const names = namesIn(id);
		const initText = init ? slice(init, source) : "undefined";
		const binding = `(${slice(id, source)} = ${initText})`;
		if (kind === "const") {
			finish(`(async () => { const ${slice(id, source)} = ${initText}; return { ${names.join(", ")} }; })()`);
			for (const name of names) emit(`const ${name} = ${SLOT}.${name};`);
			return;
		}
		if (kind === "let") emit(`let ${names.join(", ")};`);
		finish(`(async () => { ${binding}; })()`);
	}

	function emitClass(statement: Syntax): void {
		const heritage = statement["superClass"];
		const id = statement["id"];
		const bodyNode = statement["body"];
		if (!isSyntax(heritage) || !containsAwait(heritage) || !isSyntax(id) || !isSyntax(bodyNode)) {
			emit(slice(statement, source));
			return;
		}
		finish(`(async () => (${slice(heritage, source)}))()`);
		emit(`class ${slice(id, source)} extends (${SLOT}) ${slice(bodyNode, source)}`);
	}
}

function rewriteVars(statement: Syntax, source: string): string {
	const edits: Edit[] = [];
	visit(statement, null, 0);
	const base = statement.start;
	return apply(slice(statement, source), edits.map(edit => ({ start: edit.start - base, end: edit.end - base, text: edit.text })));

	function visit(node: Syntax, parent: Syntax | null, depth: number): void {
		const next = FUNCTION.has(node.type) ? depth + 1 : depth;
		if (depth === 0 && node.type === "VariableDeclaration" && node.kind === "var" && node.declarations) {
			const keyword = /^var\s/.exec(source.slice(node.start));
			if (parent && LOOP.has(parent.type) && keyword) edits.push({ start: node.start, end: node.start + keyword[0].length, text: "" });
			else if (!parent || !LOOP.has(parent.type)) rewriteVarDeclaration(node, edits);
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const item of value) if (isSyntax(item)) visit(item, node, next);
			} else if (isSyntax(value)) visit(value, node, next);
		}
	}
}

function rewriteVarDeclaration(node: Syntax, edits: Edit[]): void {
	const declarators = node.declarations ?? [];
	edits.push({ start: node.start, end: node.start + (node.kind?.length ?? 3), text: `void${declarators.length === 1 ? "" : " ("}` });
	for (const declarator of declarators) {
		if (declarator["init"]) {
			edits.push({ start: declarator.start, end: declarator.start, text: "(" });
			edits.push({ start: declarator.end, end: declarator.end, text: ")" });
		} else edits.push({ start: declarator.start, end: declarator.end, text: "(void 0)" });
	}
	if (declarators.length !== 1) {
		const last = declarators[declarators.length - 1];
		if (last) edits.push({ start: last.end, end: last.end, text: ")" });
	}
}

function declaredEarly(error: unknown): boolean {
	return typeof error === "object" && error !== null && "name" in error && error.name === "SyntaxError"
		&& "message" in error && typeof error.message === "string" && error.message.includes("already been declared");
}

function scriptBindings(program: Syntax): VmBindings {
	const lexical: string[] = [];
	const functions: string[] = [];
	for (const statement of statements(program)) {
		if (statement.type === "FunctionDeclaration") functions.push(...namesIn(statement["id"]));
		else if (statement.type === "ClassDeclaration") lexical.push(...namesIn(statement["id"]));
		else if (statement.type === "VariableDeclaration" && (statement.kind === "let" || statement.kind === "const")) {
			for (const declarator of statement.declarations ?? []) lexical.push(...namesIn(declarator["id"]));
		}
	}
	const vars: string[] = [];
	walk(program, 0, (node, depth) => {
		if (depth === 0 && node.type === "VariableDeclaration" && node.kind === "var") {
			for (const declarator of node.declarations ?? []) vars.push(...namesIn(declarator["id"]));
		}
	});
	return { lexical, vars: unique(vars), functions };
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
