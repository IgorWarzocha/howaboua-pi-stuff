import { parse, type Pattern } from "acorn";
import type { QuickJS } from "quickjs-wasi";
import { globMatcher } from "../notebook-mode/glob.ts";
import type { JsBindingStatus, JsDeclaration, JsInventory } from "./protocol.ts";
import type { JsBindings } from "./managed-bindings.ts";

/** Identifier validation and legacy inventory parsing. Managed cells have their own scope-aware compiler. */
export function jsDeclarations(source: string): JsDeclaration[] {
	const program = parse(source, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true });
	const declarations: JsDeclaration[] = [];
	const names = (pattern: Pattern): string[] => {
		switch (pattern.type) {
			case "Identifier": return [pattern.name];
			case "RestElement": return names(pattern.argument);
			case "AssignmentPattern": return names(pattern.left);
			case "ArrayPattern": return pattern.elements.flatMap(value => value ? names(value) : []);
			case "ObjectPattern": return pattern.properties.flatMap(value => names(value.type === "RestElement" ? value.argument : value.value));
			default: return [];
		}
	};
	for (const statement of program.body) {
		if (statement.type === "VariableDeclaration") {
			for (const declaration of statement.declarations) for (const name of names(declaration.id)) declarations.push({ name, kind: statement.kind });
		} else if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
			declarations.push({ name: statement.id.name, kind: statement.type === "FunctionDeclaration" ? "function" : "class" });
		}
	}
	return declarations;
}

export function inspectJsBindings(vm: QuickJS, inventory: JsInventory, query = "*", managed?: JsBindings): JsBindingStatus[] {
	const matches = globMatcher(query), baseline = new Set(inventory.baseline);
	const state = managed?.inspect(), retained = new Map(state?.bindings.map(binding => [binding.name, binding]));
	for (const name of state?.masked ?? []) baseline.add(name);
	const declarations = new Map<string, JsBindingStatus["kind"]>((state?.bindings ?? inventory.declarations).map(binding => [binding.name, binding.kind]));
	for (const name of vm.global.getOwnPropertyNames()) if (!baseline.has(name) && !declarations.has(name)) declarations.set(name, "global");
	return [...declarations].filter(([name]) => matches(name)).sort(([a], [b]) => a.localeCompare(b)).map(([name, kind]) => {
		const current = retained.get(name); if (current) return current;
		try {
			if (kind === "global" || kind === "var" || kind === "function") {
				const descriptor = vm.global.getOwnPropertyDescriptor(name);
				try { return { name, kind, type: descriptor ? descriptor.value?.typeof ?? "accessor" : "unavailable" }; }
				finally { descriptor?.value?.dispose(); descriptor?.get?.dispose(); descriptor?.set?.dispose(); }
			}
			return { name, kind, type: vm.evalCode(name).consume(value => value.typeof) };
		} catch (error) {
			// Uninitialised lexical declarations survive a failed cell in the TDZ.
			if (error && typeof error === "object" && "dispose" in error && typeof error.dispose === "function") error.dispose();
			return { name, kind, type: "unavailable" };
		}
	});
}

export function isJsInventory(value: unknown): value is JsInventory {
	if (!value || typeof value !== "object" || !("declarations" in value) || !("baseline" in value) || !("complete" in value)) return false;
	return typeof value.complete === "boolean" && Array.isArray(value.baseline) && value.baseline.every(name => typeof name === "string")
		&& Array.isArray(value.declarations) && value.declarations.every(item => item && typeof item === "object"
			&& typeof item.name === "string" && ["let", "const", "var", "using", "await using", "function", "class"].includes(item.kind)
			&& validJsBindingName(item.name));
}

export function validJsBindingName(name: string): boolean {
	try { const bindings = jsDeclarations(`let ${name};`); return bindings.length === 1 && bindings[0]?.name === name; }
	catch { return false; }
}
