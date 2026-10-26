import { randomUUID } from "node:crypto";
import { JSException, type JSValueHandle, type QuickJS } from "quickjs-wasi";
import { emptyState, type PortableState, type PortableValue } from "../ts-mode/portable-state.ts";
import { assertPortableState } from "../ts-mode/state-storage.ts";
import { inspectJsBindings, validJsBindingName } from "./bindings.ts";
import type { JsInventory } from "./protocol.ts";
import type { JsSupport } from "./support.ts";

/** The data graph format/merge is shared, never the TS runtime or its state files. */
export function assertJsData(value: unknown): asserts value is PortableState {
	try {
		if (!value || typeof value !== "object" || !("bindings" in value) || !value.bindings || typeof value.bindings !== "object") throw new Error();
		const bindings = Object.fromEntries(Object.entries(value.bindings).map(([name, binding]) => {
			if (!binding || typeof binding !== "object" || !("kind" in binding) || !["const", "let", "var"].includes(String(binding.kind)) || !validJsBindingName(name)) throw new Error();
			return [name, { ...binding, kind: binding.kind === "var" ? "let" : binding.kind }];
		}));
		assertPortableState({ ...value, bindings });
		const state = value as PortableState;
		if (state.imports.length || Object.values(state.nodes).some(node => node.kind !== "object" && node.kind !== "array")
			|| Object.values(state.bindings).some(binding => binding.source || binding.hook || binding.checkpoint || binding.module)
			|| Object.keys(state.roots).some(name => !Object.hasOwn(bindings, name)) || Object.keys(bindings).some(name => !Object.hasOwn(state.roots, name))
			|| state.pins.some(name => !Object.hasOwn(bindings, name))) throw new Error();
	} catch { throw new Error("Saved JS data is invalid or unsupported; it was not loaded"); }
}

export function captureJsData(vm: QuickJS, support: JsSupport, inventory: JsInventory, names: readonly string[]): PortableState {
	const state = emptyState();
	const known = new Map(inspectJsBindings(vm, inventory).map(binding => [binding.name, binding]));
	const object = vm.newObject(), array = vm.newArray();
	const objectPrototype = object.getPrototypeOf(), arrayPrototype = array.getPrototypeOf();
	object.dispose(); array.dispose();
	const visit = (value: JSValueHandle, path: string): PortableValue => {
		if (value.isNull) return null;
		if (value.isUndefined) return undefined;
		if (value.isString) return value.toString();
		if (value.isNumber) return value.toNumber();
		if (value.isBool) return value.toBoolean();
		if (value.isBigInt) return value.toBigInt();
		const reject = (): never => { throw new Error(`${path}: selective JS state supports primitives, plain objects and arrays; save a whole-notebook profile for this value`); };
		if (!value.isObject || value.isFunction || value.isProxy || !(value.isArray || value.className === "Object")) return reject();
		const prototype = value.getPrototypeOf();
		let nullPrototype: boolean;
		try {
			nullPrototype = prototype.isNull;
			if (value.isArray ? prototype.identity !== arrayPrototype.identity : !nullPrototype && prototype.identity !== objectPrototype.identity) return reject();
		} finally { prototype.dispose(); }
		if (!support.isExtensible(value)) return reject();
		const id = support.identity(value);
		if (Object.hasOwn(state.nodes, id)) return { ref: id };
		const properties: Record<string, PortableValue> = Object.create(null);
		state.nodes[id] = value.isArray ? { kind: "array", length: value.length, properties } : { kind: "object", nullPrototype, properties };
		const keys = value.getOwnPropertyKeys();
		try {
			for (const key of keys) {
				if (typeof key !== "string") return reject();
				const descriptor = value.getOwnPropertyDescriptor(key);
				try {
					if (!descriptor?.value || !descriptor.writable) return reject();
					if (value.isArray && key === "length") continue;
					if (!descriptor.enumerable || !descriptor.configurable) return reject();
					properties[key] = visit(descriptor.value, `${path}.${key}`);
				} finally { descriptor?.value?.dispose(); descriptor?.get?.dispose(); descriptor?.set?.dispose(); }
			}
		} finally { for (const key of keys) if (typeof key !== "string") key.dispose(); }
		return { ref: id };
	};
	try {
		for (const name of [...new Set(names)].sort()) {
			const binding = known.get(name);
			if (!validJsBindingName(name) || !binding || binding.type === "unavailable") throw new Error(`JS binding ${name} is unavailable for selective saving`);
			let value: JSValueHandle;
			if (["global", "var", "function"].includes(binding.kind)) {
				const descriptor = vm.global.getOwnPropertyDescriptor(name);
				descriptor?.get?.dispose(); descriptor?.set?.dispose();
				if (!descriptor?.value) throw new Error(`${name}: accessors cannot be saved as selected data`);
				value = descriptor.value;
			} else value = vm.evalCode(name);
			try { Object.defineProperty(state.roots, name, { value: visit(value, name), enumerable: true, writable: true, configurable: true }); }
			finally { value.dispose(); }
			const kind = binding.kind === "var" ? "var" : binding.kind === "let" || binding.kind === "global" ? "let" : "const";
			Object.defineProperty(state.bindings, name, { value: { name, kind, declaration: `${kind} ${name}` }, enumerable: true, writable: true, configurable: true });
		}
		return state;
	} finally { objectPrototype.dispose(); arrayPrototype.dispose(); }
}

/** Call in a disposable full-VM candidate. Failure must not publish partial declarations. */
export function restoreJsData(vm: QuickJS, support: JsSupport, inventory: JsInventory, state: PortableState): void {
	assertJsData(state);
	const existing = new Set(inspectJsBindings(vm, inventory).map(binding => binding.name));
	const names = Object.keys(state.bindings);
	const collisions = names.filter(name => existing.has(name) || vm.global.hasOwnProperty(name));
	if (collisions.length) throw new Error(`JS data conflicts with existing bindings: ${collisions.join(", ")}; use a fresh notebook or rename the source bindings`);
	const objects = new Map<string, JSValueHandle>();
	const primitives: JSValueHandle[] = [];
	const holder = vm.newObject(), temporary = `__js_data_${randomUUID().replaceAll("-", "")}`;
	const read = (value: PortableValue): JSValueHandle => {
		if (value !== null && typeof value === "object") {
			const object = objects.get(value.ref);
			if (!object) throw new Error("Saved JS data contains a missing reference");
			return object;
		}
		const handle = vm.hostToHandle(value); primitives.push(handle); return handle;
	};
	try {
		for (const [id, node] of Object.entries(state.nodes)) {
			const value = node.kind === "array" ? vm.newArray() : node.kind === "object" && node.nullPrototype ? vm.evalCode("({__proto__:null})") : vm.newObject();
			objects.set(id, value); support.identity(value, id);
		}
		for (const [id, node] of Object.entries(state.nodes)) {
			const value = objects.get(id)!;
			if (node.kind !== "object" && node.kind !== "array") throw new Error("Unsupported saved JS data");
			for (const [key, item] of Object.entries(node.properties)) value.defineProp(key, read(item), { writable: true, enumerable: true, configurable: true });
			if (node.kind === "array") value.setProp("length", read(node.length));
		}
		for (const name of names) holder.defineProp(name, read(state.roots[name]), { enumerable: true });
		vm.global.defineProp(temporary, holder, { configurable: true });
		vm.evalCode(names.map(name => `${state.bindings[name]!.kind} ${name}=this[${JSON.stringify(temporary)}][${JSON.stringify(name)}];`).join("\n")).dispose();
		for (const name of names) inventory.declarations.push({ name, kind: state.bindings[name]!.kind as "let" | "const" | "var" });
	} finally {
		try { vm.evalCode(`delete this[${JSON.stringify(temporary)}]`).dispose(); } catch (error) { if (error instanceof JSException) error.dispose(); }
		holder.dispose(); for (const value of objects.values()) value.dispose(); for (const value of primitives) value.dispose();
	}
}

export interface JsReleaseResult { cleared: string[]; deleted: string[]; skipped: { name: string; reason: string }[] }

/** Clear references without rebuilding recipes or pretending lexical names were undeclared. */
export function releaseJsData(vm: QuickJS, inventory: JsInventory, names: readonly string[], protectedNames: ReadonlyMap<string, string>): JsReleaseResult {
	const known = new Map(inspectJsBindings(vm, inventory).map(binding => [binding.name, binding]));
	const result: JsReleaseResult = { cleared: [], deleted: [], skipped: [] };
	for (const name of [...new Set(names)]) {
		const binding = known.get(name);
		if (!binding || !validJsBindingName(name)) { result.skipped.push({ name, reason: "binding unavailable" }); continue; }
		const protection = protectedNames.get(name);
		if (protection) { result.skipped.push({ name, reason: protection }); continue; }
		if (binding.kind === "global" || binding.kind === "var" || binding.kind === "function") {
			const descriptor = vm.global.getOwnPropertyDescriptor(name);
			try {
				if (descriptor?.configurable) {
					vm.evalCode(`delete this[${JSON.stringify(name)}]`).dispose();
					inventory.declarations = inventory.declarations.filter(binding => binding.name !== name); result.deleted.push(name);
				}
				else if (descriptor?.value && descriptor.writable) { vm.global.setProp(name, vm.undefined); result.cleared.push(name); }
				else result.skipped.push({ name, reason: "read-only binding" });
			} finally { descriptor?.value?.dispose(); descriptor?.get?.dispose(); descriptor?.set?.dispose(); }
		} else if ((binding.kind === "let" || binding.kind === "class") && binding.type !== "unavailable") {
			vm.evalCode(`${name}=void 0`).dispose(); result.cleared.push(name);
		} else result.skipped.push({ name, reason: "immutable or uninitialised lexical binding; reset is required to remove it" });
	}
	return result;
}
