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

interface Edit {
	start: number;
	end: number;
	text: string;
}

export interface VmBindings {
	lexical: string[];
	vars: string[];
	functions: string[];
}
export type VmPlan = { source: string; bindings: VmBindings } & (
	| { awaited: true }
	| { awaited: false; parseError?: unknown }
);

const FUNCTION = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunctionExpression",
	"StaticBlock",
]);
const LOOP = new Set(["ForStatement", "ForInStatement", "ForOfStatement"]);
const HOST = `globalThis[Symbol.for("pi.vm-code/init")]`;

/**
 * Awaited cells run as one module. `let`, `const` and `class` exist for the whole cell, and a
 * function closes over those bindings. Each declarator is published when its initializer
 * finishes, so a later rejection keeps the earlier value.
 */
export function planVmCell(
	source: string,
	bound: (name: string) => boolean = () => false,
): VmPlan {
	let program: Syntax;
	try {
		program = parse(source, {
			ecmaVersion: "latest",
			allowAwaitOutsideFunction: true,
			sourceType: "script",
		}) as unknown as Syntax;
	} catch (error) {
		if (declaredEarly(error)) throw error;
		return {
			awaited: false,
			source,
			bindings: noBindings(),
			parseError: error,
		};
	}
	const bindings = scriptBindings(program);
	if (!containsAwait(program)) return { awaited: false, source, bindings };
	return {
		awaited: true,
		source: compileModule(source, program, bindings, bound),
		bindings,
	};
}

function compileModule(
	source: string,
	program: Syntax,
	bindings: VmBindings,
	bound: (name: string) => boolean,
): string {
	const freshVars = bindings.vars.filter((name) => !bound(name));
	const header = moduleHeader(freshVars, bindings.functions);
	const body = statements(program);
	const headerAt = body[0]?.directive === "use strict" ? body[0].end : 0;
	const edits: Edit[] = [];
	if (header)
		edits.push({
			start: headerAt,
			end: headerAt,
			text: headerAt === 0 ? header : `\n${header}`,
		});
	for (const statement of body) {
		if (
			statement.directive === "use strict" ||
			statement.type === "FunctionDeclaration"
		)
			continue;
		if (statement.type === "ClassDeclaration") {
			const names = namesIn(statement["id"]);
			if (names.length)
				edits.push({
					start: statement.end,
					end: statement.end,
					text: `\n${bindCalls("class", names)};`,
				});
			continue;
		}
		if (
			statement.type === "VariableDeclaration" &&
			(statement.kind === "let" || statement.kind === "const") &&
			statement.declarations?.length
		) {
			edits.push({
				start: statement.start,
				end: statement.end,
				text: splitLexical(statement.kind, statement.declarations, source),
			});
			continue;
		}
		const rewritten = rewriteVars(statement, source);
		if (rewritten !== slice(statement, source))
			edits.push({
				start: statement.start,
				end: statement.end,
				text: rewritten,
			});
	}
	return apply(source, edits);
}

function moduleHeader(vars: string[], functions: string[]): string {
	const lines: string[] = [];
	if (vars.length)
		lines.push(`var ${vars.join(", ")};`, `${bindCalls("var", vars)};`);
	if (functions.length) lines.push(`${bindCalls("function", functions)};`);
	return lines.length ? `${lines.join("\n")}\n` : "";
}

function splitLexical(
	kind: string,
	declarators: Syntax[],
	source: string,
): string {
	return declarators
		.map((declarator) => {
			const names = namesIn(declarator["id"]);
			const declaration = `${kind} ${slice(declarator, source)};`;
			return names.length
				? `${declaration}\n${bindCalls(kind, names)};`
				: declaration;
		})
		.join("\n");
}

function bindCalls(kind: string, names: string[]): string {
	return names
		.map(
			(name) =>
				`${HOST}.bind(${JSON.stringify(kind)},${JSON.stringify(name)},() => ${name},function(){${name} = arguments[0]})`,
		)
		.join(";\n");
}

function rewriteVars(statement: Syntax, source: string): string {
	const edits: Edit[] = [];
	visit(statement, null, 0);
	const base = statement.start;
	return apply(
		slice(statement, source),
		edits.map((edit) => ({
			start: edit.start - base,
			end: edit.end - base,
			text: edit.text,
		})),
	);

	function visit(node: Syntax, parent: Syntax | null, depth: number): void {
		const next = FUNCTION.has(node.type) ? depth + 1 : depth;
		if (
			depth === 0 &&
			node.type === "VariableDeclaration" &&
			node.kind === "var" &&
			node.declarations
		) {
			const keyword = /^var\s/.exec(source.slice(node.start));
			if (parent && LOOP.has(parent.type) && keyword)
				edits.push({
					start: node.start,
					end: node.start + keyword[0].length,
					text: "",
				});
			else if (!parent || !LOOP.has(parent.type))
				rewriteVarDeclaration(node, edits);
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
	edits.push({
		start: node.start,
		end: node.start + (node.kind?.length ?? 3),
		text: `void${declarators.length === 1 ? "" : " ("}`,
	});
	for (const declarator of declarators) {
		if (declarator["init"]) {
			edits.push({ start: declarator.start, end: declarator.start, text: "(" });
			edits.push({ start: declarator.end, end: declarator.end, text: ")" });
		} else
			edits.push({
				start: declarator.start,
				end: declarator.end,
				text: "(void 0)",
			});
	}
	if (declarators.length !== 1) {
		const last = declarators[declarators.length - 1];
		if (last) edits.push({ start: last.end, end: last.end, text: ")" });
	}
}

function declaredEarly(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "SyntaxError" &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message.includes("already been declared")
	);
}

function scriptBindings(program: Syntax): VmBindings {
	const lexical: string[] = [];
	const functions: string[] = [];
	for (const statement of statements(program)) {
		if (statement.type === "FunctionDeclaration")
			functions.push(...namesIn(statement["id"]));
		else if (statement.type === "ClassDeclaration")
			lexical.push(...namesIn(statement["id"]));
		else if (
			statement.type === "VariableDeclaration" &&
			(statement.kind === "let" || statement.kind === "const")
		) {
			for (const declarator of statement.declarations ?? [])
				lexical.push(...namesIn(declarator["id"]));
		}
	}
	const vars: string[] = [];
	walk(program, 0, (node, depth) => {
		if (
			depth === 0 &&
			node.type === "VariableDeclaration" &&
			node.kind === "var"
		) {
			for (const declarator of node.declarations ?? [])
				vars.push(...namesIn(declarator["id"]));
		}
	});
	return { lexical, vars: unique(vars), functions };
}

function containsAwait(node: Syntax): boolean {
	let found = false;
	walk(node, 0, (child, depth) => {
		if (
			depth === 0 &&
			(child.type === "AwaitExpression" ||
				(child.type === "ForOfStatement" && child.await === true))
		)
			found = true;
	});
	return found;
}

function statements(program: Syntax): Syntax[] {
	const body = program["body"];
	return Array.isArray(body) ? body.filter(isSyntax) : [];
}

function namesIn(pattern: unknown): string[] {
	if (!isSyntax(pattern)) return [];
	if (pattern.type === "Identifier" && pattern["name"])
		return [String(pattern["name"])];
	if (pattern.type === "RestElement") return namesIn(pattern["argument"]);
	if (pattern.type === "AssignmentPattern") return namesIn(pattern["left"]);
	if (
		pattern.type === "ObjectPattern" &&
		Array.isArray(pattern["properties"])
	) {
		return pattern["properties"].flatMap((property) =>
			isSyntax(property) && property.type === "Property"
				? namesIn(property["value"])
				: namesIn(property),
		);
	}
	if (pattern.type === "ArrayPattern" && Array.isArray(pattern["elements"]))
		return pattern["elements"].flatMap(namesIn);
	return [];
}

function walk(
	node: Syntax,
	depth: number,
	visit: (node: Syntax, depth: number) => void,
): void {
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
	for (const edit of [...edits].sort(
		(left, right) => right.start - left.start || right.end - left.end,
	)) {
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

function noBindings(): VmBindings {
	return { lexical: [], vars: [], functions: [] };
}

function isSyntax(value: unknown): value is Syntax {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}
