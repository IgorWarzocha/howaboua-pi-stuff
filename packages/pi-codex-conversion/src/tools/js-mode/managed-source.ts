import { randomUUID } from "node:crypto";
import { parse, type AnyNode, type Pattern, type VariableDeclaration, type FunctionDeclaration } from "acorn";
import type { JsDeclaration } from "./protocol.ts";

class Scope {
	readonly parent: Scope | undefined;
	readonly names = new Set<string>();
	readonly lexical = new Set<string>();
	readonly functionScope: Scope;
	readonly strict: boolean;
	constructor(parent?: Scope, functionScope?: Scope, strict = parent?.strict ?? false) { this.parent = parent; this.functionScope = functionScope ?? this; this.strict = strict; }
}
interface Edit { start: number; end: number; text: string }
export interface ManagedCell { source: string; declarations: JsDeclaration[]; references: string[] }

/** Native cell-local lexicals retain const/TDZ/closure semantics. Free references
 * capture stable binding records rather than looking up later replacement names. */
export function managedCell(source: string, existing: ReadonlyMap<string, JsDeclaration["kind"]>): ManagedCell {
	const program = parse(source, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true });
	const scopes = new WeakMap<AnyNode, Scope>(), declarations = new Map<string, JsDeclaration>();
	const bindingIds = new WeakSet<AnyNode>(), variables = new Map<VariableDeclaration, boolean>(), functions: FunctionDeclaration[] = [];
	const blockFunctions: { node: FunctionDeclaration; scope: Scope }[] = [];
	const reusedBlockFunctions: FunctionDeclaration[] = [];
	const reused = new Set<string>();
	const strictBody = (body: readonly AnyNode[]): boolean => body.some(statement => statement.type === "ExpressionStatement" && statement.directive === "use strict");
	const root = new Scope(undefined, undefined, strictBody(program.body));
	const children = (node: AnyNode, visit: (child: AnyNode, key: string) => void): void => {
		for (const [key, value] of Object.entries(node)) {
			if (key === "loc" || key === "range") continue;
			const items: unknown[] = Array.isArray(value) ? value : [value];
			for (const item of items) if (item && typeof item === "object" && "type" in item && typeof item.type === "string" && "start" in item) visit(item as AnyNode, key);
		}
	};
	const names = (pattern: Pattern): string[] => {
		switch (pattern.type) {
			case "Identifier": return [pattern.name];
			case "RestElement": return names(pattern.argument);
			case "AssignmentPattern": return names(pattern.left);
			case "ArrayPattern": return pattern.elements.flatMap(item => item ? names(item) : []);
			case "ObjectPattern": return pattern.properties.flatMap(item => names(item.type === "RestElement" ? item.argument : item.value));
			default: return [];
		}
	};
	const declare = (name: string, kind: JsDeclaration["kind"]): void => {
		const previous = existing.get(name);
		if (previous !== undefined) {
			if (!["var", "function"].includes(kind) || !["var", "function"].includes(previous)) throw new Error(`JS binding ${name} already exists; release it before redeclaring`);
			reused.add(name);
		} else declarations.set(name, { name, kind });
	};
	// Mark binding positions separately: default values and computed pattern keys
	// are expressions and must still resolve earlier-cell references.
	const pattern = (node: Pattern, scope: Scope, target: Scope, topKind?: JsDeclaration["kind"]): void => {
		scopes.set(node, scope);
		switch (node.type) {
			case "Identifier":
				if (topKind) declare(node.name, topKind);
				if (target !== root || !reused.has(node.name)) { target.names.add(node.name); bindingIds.add(node); }
				break;
			case "RestElement": pattern(node.argument, scope, target, topKind); break;
			case "AssignmentPattern": pattern(node.left, scope, target, topKind); scan(node.right, scope); break;
			case "ArrayPattern": for (const item of node.elements) if (item) pattern(item, scope, target, topKind); break;
			case "ObjectPattern": for (const item of node.properties) {
				scopes.set(item, scope);
				if (item.type === "RestElement") pattern(item.argument, scope, target, topKind);
				else { if (item.computed) scan(item.key, scope); pattern(item.value, scope, target, topKind); }
			} break;
			default: scan(node, scope);
		}
	};
	const scan = (node: AnyNode, outer: Scope, parent?: AnyNode): void => {
		let scope = outer; scopes.set(node, scope);
		switch (node.type) {
			case "WithStatement": throw new Error("JS Notebook does not support with statements; use explicit object properties");
			case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": {
				if (node.type === "FunctionDeclaration" && node.id) {
					if (parent === program) { declare(node.id.name, "function"); functions.push(node); }
					else if (outer !== outer.functionScope && !node.async && !node.generator) blockFunctions.push({ node, scope: outer });
					if (outer !== root || !reused.has(node.id.name)) { outer.names.add(node.id.name); bindingIds.add(node.id); }
				}
				const parameters = new Scope(outer, undefined, outer.strict || node.body.type === "BlockStatement" && strictBody(node.body.body));
				if (node.type === "FunctionExpression" && node.id) { parameters.names.add(node.id.name); bindingIds.add(node.id); }
				if (node.type !== "ArrowFunctionExpression") parameters.names.add("arguments");
				for (const parameter of node.params) pattern(parameter, parameters, parameters);
				const body = new Scope(parameters); scopes.set(node.body, body);
				if (node.body.type === "BlockStatement") for (const statement of node.body.body) scan(statement, body, node.body);
				else scan(node.body, parameters, node);
				return;
			}
			case "ClassDeclaration": case "ClassExpression": {
				if (node.type === "ClassDeclaration" && node.id) {
					outer.names.add(node.id.name); outer.lexical.add(node.id.name); bindingIds.add(node.id);
					if (parent === program) declare(node.id.name, "class");
				}
				scope = new Scope(outer, outer.functionScope, true);
				if (node.id) { scope.names.add(node.id.name); bindingIds.add(node.id); }
				if (node.superClass) scan(node.superClass, scope, node);
				scan(node.body, scope, node); return;
			}
			case "BlockStatement": case "CatchClause": case "ForStatement": case "ForInStatement": case "ForOfStatement":
				scope = new Scope(outer, outer.functionScope); scopes.set(node, scope);
				if (node.type === "CatchClause" && node.param) pattern(node.param, scope, scope);
				break;
			case "StaticBlock": scope = new Scope(outer); scopes.set(node, scope); break;
			case "SwitchStatement": {
				scan(node.discriminant, outer, node);
				scope = new Scope(outer, outer.functionScope);
				for (const branch of node.cases) scan(branch, scope, node); return;
			}
			case "VariableDeclaration": {
				const target = node.kind === "var" ? scope.functionScope : scope;
				const top = target === root && (node.kind === "var" || parent === program);
				if (top && node.kind === "var") variables.set(node, parent?.type === "ForInStatement" || parent?.type === "ForOfStatement");
				for (const declaration of node.declarations) {
					scopes.set(declaration, scope);
					if (node.kind !== "var") for (const name of names(declaration.id)) target.lexical.add(name);
					pattern(declaration.id, scope, target, top ? node.kind : undefined);
					if (declaration.init) scan(declaration.init, scope, declaration);
				} return;
			}
		}
		children(node, (child, key) => { if (!(node.type === "CatchClause" && key === "param")) scan(child, scope, node); });
	};
	scan(program, root);
	// Sloppy block functions also have a native function-scoped var alias unless
	// an enclosing lexical declaration blocks Annex B's additional binding.
	for (const { node, scope } of blockFunctions) {
		if (scope.strict) continue;
		const name = node.id.name, target = scope.functionScope;
		let blocked = false;
		for (let current = scope.parent; current; current = current.parent) {
			if (current.lexical.has(name)) blocked = true;
			if (current === target) break;
		}
		if (blocked || target === root && existing.has(name) && !["var", "function"].includes(existing.get(name)!)) continue;
		if (target === root && !declarations.has(name) && !reused.has(name)) declare(name, "var");
		if (target !== root || !reused.has(name)) target.names.add(name);
		else reusedBlockFunctions.push(node);
	}
	const prefix = `__nb_${randomUUID().replaceAll("-", "")}`, api = `${prefix}_api`;
	const references = new Map<string, string>(), edits: Edit[] = [];
	const referenceNames: string[] = [], strictReferences: { name: string; reference: string }[] = [];
	const referenceFor = (name: string, strict = false): string => {
		const key = strict ? `strict:${name}` : name;
		let reference = references.get(key);
		if (!reference) {
			reference = `${prefix}_${references.size}`; references.set(key, reference); referenceNames.push(name);
			// Strict writes to these names are syntax errors; keep read-only captures
			// without synthesizing an equally illegal native setter.
			if (strict && name !== "arguments" && name !== "eval") strictReferences.push({ name, reference });
		}
		return reference;
	};
	const free = (name: string, scope: Scope): boolean => { for (let current: Scope | undefined = scope; current; current = current.parent) if (current.names.has(name)) return false; return true; };
	const visit = (node: AnyNode, parent?: AnyNode, key?: string, grandparent?: AnyNode): void => {
		if (node.type === "Identifier" && !bindingIds.has(node)) {
			const propertyKey = (parent?.type === "Property" || parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && key === "key" && !parent.computed;
			const syntaxName = propertyKey || parent?.type === "MemberExpression" && key === "property" && !parent.computed
				|| parent?.type === "LabeledStatement" && key === "label" || parent?.type === "BreakStatement" || parent?.type === "ContinueStatement"
				|| parent?.type === "MetaProperty" || key === "id" && (parent?.type === "FunctionDeclaration" || parent?.type === "FunctionExpression" || parent?.type === "ClassDeclaration" || parent?.type === "ClassExpression");
			const scope = scopes.get(node) ?? root;
			if (!syntaxName && free(node.name, scope)) {
				if ((node.name === "eval" || node.name === "Function") && !existing.has(node.name)) throw new Error("Dynamic code evaluation cannot access managed notebook bindings; write the JavaScript directly in a cell");
				{
					const reference = referenceFor(node.name, scope.strict);
					let text = `${reference}.value`;
					if (parent?.type === "UnaryExpression" && parent.operator === "typeof") { edits.push({ start: parent.start, end: parent.end, text: `${reference}.type` }); return; }
					if (parent?.type === "UnaryExpression" && parent.operator === "delete") { edits.push({ start: parent.start, end: parent.end, text: `${reference}.delete()` }); return; }
					if (parent?.type === "CallExpression" && key === "callee" || parent?.type === "TaggedTemplateExpression" && key === "tag") text = `(0,${text})`;
					const property = parent?.type === "Property" ? parent : parent?.type === "AssignmentPattern" ? grandparent : undefined;
					if (property?.type === "Property" && property.shorthand && property.value.start === node.start) text = `${JSON.stringify(node.name)}:${text}`;
					edits.push({ start: node.start, end: node.end, text });
				}
			}
		}
		children(node, (child, field) => visit(child, node, field, parent));
	};
	visit(program);
	for (const node of reusedBlockFunctions) {
		const reference = referenceFor(node.id.name);
		edits.push({ start: node.end, end: node.end, text: `;${reference}.value=${node.id.name};` });
	}
	const render = (start: number, end: number): string => {
		let text = source.slice(start, end);
		for (const edit of edits.filter(edit => edit.start >= start && edit.end <= end).sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start - start) + edit.text + text.slice(edit.end - start);
		return text;
	};
	const replace = (node: AnyNode, text: string): void => {
		for (let i = edits.length - 1; i >= 0; i--) if (edits[i]!.start >= node.start && edits[i]!.end <= node.end) edits.splice(i, 1);
		edits.push({ start: node.start, end: node.end, text });
	};
	// Top-level var may redeclare an existing binding. Rewrite only these var
	// declarations to assignments; new var slots are hoisted in the native cell.
	for (const [declaration, iterationTarget] of variables) {
		const parts = declaration.declarations.flatMap(item => item.init ? [`(${render(item.id.start, item.id.end)}=${render(item.init.start, item.init.end)})`] : []);
		const tail = source.slice(declaration.start, declaration.end).endsWith(";") ? ";" : "";
		if (iterationTarget) {
			// for-in/of has an assignment target, not an initialiser expression.
			const item = declaration.declarations[0]!;
			replace(declaration, render(item.id.start, item.id.end));
		} else replace(declaration, (parts.join(",") || "void 0") + tail);
	}
	const hoisted: string[] = [];
	for (const declaration of functions) if (reused.has(declaration.id.name)) {
		const reference = referenceFor(declaration.id.name, root.strict);
		const header = source.slice(declaration.start, declaration.id.start), rest = render(declaration.id.end, declaration.end);
		hoisted.push(`${reference}.value=${header}${rest};`); replace(declaration, ";");
	}
	const fresh = [...declarations.values()];
	const vars = fresh.filter(binding => binding.kind === "var").map(binding => binding.name);
	const strict = root.strict ? '"use strict";\n' : "";
	// Keep strict global writes native without changing saved binding records.
	// Managed and masked names still use their captured record after release/reuse.
	const record = `${prefix}_record`, value = `${prefix}_value`;
	const captureStrict = strictReferences.map(({ name, reference }) => `${reference}=(${record}=>({
get value(){return ${record}.value},
set value(${value}){"use strict";if(${record}.kind||${api}.masked(${JSON.stringify(name)}))${record}.value=${value};else ${name}=${value}},
get type(){return ${record}.type}
}))(${reference});`).join("\n");
	const registration = fresh.map(({ name, kind }) => `${api}.install(${JSON.stringify(name)},${JSON.stringify(kind)},()=>${name},${["const", "using", "await using"].includes(kind) ? "void 0" : `${prefix}_value=>${name}=${prefix}_value`});`).join("\n");
	return { source: `(async (${[api, ...references.values()].join(",")})=>{\n${strict}${vars.length ? `var ${vars.join(",")};\n` : ""}${captureStrict}\n${registration}\n${hoisted.join("\n")}\n${render(0, source.length)}\n})`, declarations: fresh, references: referenceNames };
}
