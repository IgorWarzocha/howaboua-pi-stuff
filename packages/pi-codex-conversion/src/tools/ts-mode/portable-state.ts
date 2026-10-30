import { ownersOfNode, remapPortableState } from "./portable-state-operations.ts";
export { forkPortableState, checkpointRoots, mergeState, compactState } from "./portable-state-operations.ts";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { types } from "node:util";

export type PortableValue = null | undefined | string | number | boolean | bigint | { ref: string };
export type PortableNode =
	| { kind: "object"; nullPrototype: boolean; properties: Record<string, PortableValue> }
	| { kind: "array"; length: number; properties: Record<string, PortableValue> }
	| { kind: "map"; entries: [PortableValue, PortableValue][] }
	| { kind: "set"; entries: PortableValue[] }
	| { kind: "binary"; bytes: Uint8Array }
	| { kind: "date"; time: number }
	| { kind: "regexp"; source: string; flags: string; lastIndex: number }
	| { kind: "view"; constructor: string; buffer: PortableValue; byteOffset: number; length: number }
	| { kind: "recipe"; name: string; properties: Record<string, PortableValue> }
	| { kind: "checkpoint"; snapshot: string; restore: string; data: PortableValue }
	| { kind: "module"; specifier: string; imported: string; attributes?: Record<string, string> | undefined };

export interface BindingRecipe {
	name: string;
	kind: string;
	declaration: string;
	source?: string | undefined;
	references?: string[] | undefined;
	module?: { specifier: string; imported: string; attributes?: Record<string, string> | undefined } | undefined;
	hook?: "startup" | "tool_result" | undefined;
	checkpoint?: { snapshot: string; restore: string } | undefined;
}

export interface PortableCapture {
	state: PortableState;
	skipped: { name: string; reason: string }[];
}

export class CheckpointRestoreError extends Error {
	readonly bindings: string[];
	constructor(message: string, bindings: string[]) { super(message); this.bindings = bindings; }
}

export interface PortableState {
	version: 1;
	roots: Record<string, PortableValue>;
	nodes: Record<string, PortableNode>;
	bindings: Record<string, BindingRecipe>;
	pins: string[];
	imports: string[];
}

export function emptyState(): PortableState {
	return { version: 1, roots: {}, nodes: {}, bindings: {}, pins: [], imports: [] };
}

/** IDs survive worker restoration so a mutation of an aliased object has one merge owner. */
export class PortableGraph {
	private readonly realmPrototypes = new Map<string, Set<object>>();
	private readonly realmConstructors = new Map<string, Function>();

	/** Register trusted intrinsics before user code can shadow realm globals. */
	registerRealm(intrinsics: Record<string, Function>): void {
		for (const [name, constructor] of Object.entries(intrinsics)) {
			if (typeof constructor !== "function") throw new Error(`Invalid TS realm intrinsic ${name}`);
			this.realmConstructors.set(name, constructor);
			const prototypes = this.realmPrototypes.get(name) ?? new Set<object>();
			prototypes.add(constructor.prototype);
			this.realmPrototypes.set(name, prototypes);
		}
	}

	private create<T>(name: string, fallback: Function, args: unknown[]): T {
		return Reflect.construct(this.realmConstructors.get(name) ?? fallback, args) as T;
	}

	private hasPrototype(value: object, name: string, hostPrototype: object): boolean {
		const prototype: unknown = Object.getPrototypeOf(value);
		return prototype === hostPrototype || (typeof prototype === "object" && prototype !== null && this.realmPrototypes.get(name)?.has(prototype) === true);
	}
	private readonly identities = new WeakMap<object, string>();
	private readonly recipes = new WeakMap<object, { name: string; descriptors: Map<PropertyKey, PropertyDescriptor>; prototypeDescriptors?: Map<PropertyKey, PropertyDescriptor> | undefined }>();
	private readonly modules = new Map<object, Extract<PortableNode, { kind: "module" }>>();
	private checkpoints = new Map<object, { snapshot: string; restore: string; data: unknown }>();
	private liveOnlyHint: string | undefined;

	/** Snapshot current values once, before the graph's per-root portability probes. */
	async prepareCheckpoints(values: Record<string, unknown>, bindings: Record<string, BindingRecipe>): Promise<void> {
		this.checkpoints = new Map();
		for (const [name, binding] of Object.entries(bindings)) {
			if (!binding.checkpoint) continue;
			const value = values[name];
			if ((typeof value !== "object" || value === null) && typeof value !== "function") throw new Error(`TS checkpoint ${name} requires an object or function`);
			const previous = this.checkpoints.get(value);
			if (previous) {
				if (previous.snapshot !== binding.checkpoint.snapshot || previous.restore !== binding.checkpoint.restore) throw new Error(`TS checkpoint ${name} aliases an object with different checkpoint helpers`);
				continue;
			}
			const snapshot = values[binding.checkpoint.snapshot];
			const restore = values[binding.checkpoint.restore];
			if (typeof snapshot !== "function" || typeof restore !== "function") throw new Error(`TS checkpoint ${name} requires available snapshot and restore helpers`);
			try { this.checkpoints.set(value, { ...binding.checkpoint, data: await snapshot(value) }); }
			catch (cause) { throw new Error(`TS snapshot ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
		}
	}

	/** Live execution is unrestricted; durability captures only independently restorable roots. */
	capture(values: Record<string, unknown>, bindings: Record<string, BindingRecipe>, pins: string[], imports: string[] = []): PortableCapture {
		const skipped = new Map<string, string>();
		for (const [name, binding] of Object.entries(bindings)) if (binding.kind !== "type" && !Object.hasOwn(values, name)) skipped.set(name, "runtime value unavailable for capture");
		const hint = this.liveOnlyHint;
		this.liveOnlyHint = undefined;
		let hintedFailure: { name: string; reason: string } | undefined;
		// Most heaps are fully portable. Traverse their shared graph once; only
		// live-only heaps need per-root probes and dependency exclusion below.
		if (!skipped.size) {
			// A prior failure only changes probe order: nested mutations can make
			// that root portable again, so always inspect its current graph.
			if (hint && Object.hasOwn(values, hint)) {
				try { this.encode({ [hint]: values[hint] }, bindings, pins, imports); }
				catch (error) { hintedFailure = { name: hint, reason: error instanceof Error ? error.message : String(error) }; }
			}
			if (!hintedFailure) {
				try { return { state: this.encode(values, bindings, pins, imports), skipped: [] }; }
				catch { /* Per-root probes report every live-only value and dependant. */ }
			}
		}
		for (const [name, value] of Object.entries(values)) {
			if (hintedFailure?.name === name) {
				skipped.set(name, hintedFailure.reason);
				this.liveOnlyHint ??= name;
				continue;
			}
			try { this.encode({ [name]: value }, bindings, pins, imports); }
			catch (error) { skipped.set(name, error instanceof Error ? error.message : String(error)); this.liveOnlyHint ??= name; }
		}
		// A portable recipe cannot restore if one of its retained lexical dependencies cannot.
		let changed = true;
		while (changed) {
			changed = false;
			for (const [name, binding] of Object.entries(bindings)) {
				if (skipped.has(name)) continue;
				const dependency = bindingDependencies(binding).find(reference => skipped.has(reference));
				if (dependency) { skipped.set(name, `requires live-only binding ${dependency}`); changed = true; continue; }
				if (!Object.hasOwn(values, name)) continue;
				const probe = this.encode({ [name]: values[name] }, bindings, pins, imports);
				const recipe = Object.values(probe.nodes).find(node => node.kind === "recipe" && skipped.has(node.name));
				if (recipe?.kind === "recipe") { skipped.set(name, `requires live-only recipe ${recipe.name}`); changed = true; }
				const checkpoint = Object.values(probe.nodes).find(node => node.kind === "checkpoint" && (skipped.has(node.snapshot) || skipped.has(node.restore)));
				if (checkpoint?.kind === "checkpoint") { skipped.set(name, "requires live-only checkpoint helper"); changed = true; }
			}
		}
		const retained = Object.fromEntries(Object.entries(bindings).filter(([name]) => !skipped.has(name)));
		const state = this.encode(Object.fromEntries(Object.entries(values).filter(([name]) => !skipped.has(name))), retained, pins.filter(name => !skipped.has(name)), imports);
		return { state, skipped: [...skipped].map(([name, reason]) => ({ name, reason })) };
	}

	registerRecipe(value: unknown, name: string): void {
		if (typeof value === "function") {
			const prototype: unknown = Reflect.get(value, "prototype");
			this.recipes.set(value, { name, descriptors: descriptors(value), ...(typeof prototype === "object" && prototype !== null ? { prototypeDescriptors: descriptors(prototype) } : {}) });
		}
	}
	registerModule(value: unknown, specifier: string, imported: string, attributes?: Record<string, string>): void {
		if ((typeof value === "object" && value !== null) || typeof value === "function") this.modules.set(value, { kind: "module", specifier, imported, ...(attributes ? { attributes } : {}) });
	}

	encode(values: Record<string, unknown>, bindings: Record<string, BindingRecipe>, pins: string[], imports: string[] = []): PortableState {
		const state = emptyState();
		state.bindings = bindings;
		state.pins = pins;
		state.imports = imports;
		const visit = (value: unknown, path: string): PortableValue => {
			if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
			if (typeof value !== "object" && typeof value !== "function") throw new Error(`${path}: ${typeof value} values cannot transfer; store plain data instead`);
			const id = this.identities.get(value) ?? randomUUID();
			this.identities.set(value, id);
			if (Object.hasOwn(state.nodes, id)) return { ref: id };
			const recipe = this.recipes.get(value);
			const module = this.modules.get(value);
			const checkpoint = this.checkpoints.get(value);
			if (checkpoint) {
				// Snapshot data must be ordinary portable data, never a path back to a live handle.
				const registered = this.checkpoints;
				this.checkpoints = new Map();
				try {
					const data = this.encode({ data: checkpoint.data }, bindings, [], []);
					for (const object of registered.keys()) { const liveId = this.identities.get(object); if (liveId && Object.hasOwn(data.nodes, liveId)) throw new Error(`${path}: snapshot data contains a registered live object; return its data instead`); }
					// Snapshots are by-value payloads, not fresh live identities on every capture.
					// Stable local IDs let unchanged captures merge across independent sessions.
					const payload = remapPortableState(data, index => `${id}:snapshot:${index}`);
					Object.assign(state.nodes, payload.nodes);
					state.nodes[id] = { kind: "checkpoint", snapshot: checkpoint.snapshot, restore: checkpoint.restore, data: payload.roots["data"] };
				} finally { this.checkpoints = registered; }
				return { ref: id };
			}
			if (module) { state.nodes[id] = module; return { ref: id }; }
			if (recipe) {
				const prototype: unknown = Reflect.get(value, "prototype");
				if (!sameDescriptors(value, recipe.descriptors, true) || (recipe.prototypeDescriptors && (typeof prototype !== "object" || prototype === null || !sameDescriptors(prototype, recipe.prototypeDescriptors)))) throw new Error(`${path}: mutated standard function properties/prototype cannot transfer; store this data in a separate binding`);
				const properties: Record<string, PortableValue> = {};
				state.nodes[id] = { kind: "recipe", name: recipe.name, properties };
				for (const key of Reflect.ownKeys(value)) {
					if (recipe.descriptors.has(key)) continue;
					const descriptor = Object.getOwnPropertyDescriptor(value, key);
					if (typeof key !== "string" || !descriptor || !("value" in descriptor) || !descriptor.writable || !descriptor.enumerable || !descriptor.configurable) throw new Error(`${path}.${String(key)}: function accessors/nonstandard descriptors cannot transfer`);
					Object.defineProperty(properties, key, { value: visit(descriptor.value, `${path}.${key}`), enumerable: true, writable: true, configurable: true });
				}
				return { ref: id };
			}
			if (typeof value === "function") throw new Error(`${path}: function has no portable top-level recipe (captured closures cannot transfer); define a self-contained top-level function or store its data explicitly`);
			if (!Object.isExtensible(value)) throw new Error(`${path}: frozen/sealed objects cannot transfer yet; retain ordinary data instead`);
			// Install a placeholder before traversing cycles.
			state.nodes[id] = { kind: "object", nullPrototype: false, properties: {} };
			if (types.isMap(value) || types.isSet(value) || types.isDate(value) || types.isRegExp(value) || types.isArrayBuffer(value)) {
				const Constructor = types.isMap(value) ? Map : types.isSet(value) ? Set : types.isDate(value) ? Date : types.isRegExp(value) ? RegExp : ArrayBuffer;
				if (!this.hasPrototype(value, Constructor.name, Constructor.prototype)) throw new Error(`${path}: custom built-in subclasses cannot transfer; store ordinary built-in values`);
				const unexpected = Reflect.ownKeys(value).filter(key => !(types.isRegExp(value) && key === "lastIndex"));
				if (unexpected.length) throw new Error(`${path}: extra properties on built-in values cannot transfer; store them separately`);
			}
			if (types.isMap(value)) state.nodes[id] = { kind: "map", entries: [...value].map(([key, item], i) => [visit(key, `${path}.key${i}`), visit(item, `${path}.value${i}`)]) };
			else if (types.isSet(value)) state.nodes[id] = { kind: "set", entries: [...value].map((item, i) => visit(item, `${path}[${i}]`)) };
			else if (types.isDate(value)) state.nodes[id] = { kind: "date", time: value.getTime() };
			else if (types.isRegExp(value)) state.nodes[id] = { kind: "regexp", source: value.source, flags: value.flags, lastIndex: value.lastIndex };
			else if (types.isArrayBuffer(value)) {
				if (value.resizable) throw new Error(`${path}: resizable buffers cannot transfer; use a fixed ArrayBuffer`);
				state.nodes[id] = { kind: "binary", bytes: serialize(value) };
			}
			else if (ArrayBuffer.isView(value)) {
				if (!types.isArrayBuffer(value.buffer)) throw new Error(`${path}: shared buffers cannot transfer safely`);
				const constructors = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView, Buffer];
				const Constructor = constructors.find(candidate => this.hasPrototype(value, candidate.name, candidate.prototype));
				if (!Constructor) throw new Error(`${path}: custom typed-array subclasses cannot transfer`);
				const bytes: unknown = Reflect.get(Constructor, "BYTES_PER_ELEMENT");
				const length = types.isDataView(value) ? value.byteLength : typeof bytes === "number" ? value.byteLength / bytes : 0;
				if (Object.getOwnPropertyNames(value).length !== (types.isDataView(value) ? 0 : length)) throw new Error(`${path}: extra typed-array properties cannot transfer`);
				if (Object.getOwnPropertySymbols(value).length) throw new Error(`${path}: symbol properties cannot transfer`);
				state.nodes[id] = { kind: "view", constructor: Constructor.name, buffer: visit(value.buffer, `${path}.buffer`), byteOffset: value.byteOffset, length };
			}
			else {
				const prototype: unknown = Object.getPrototypeOf(value);
				if ((Array.isArray(value) && !this.hasPrototype(value, "Array", Array.prototype)) || (!Array.isArray(value) && !this.hasPrototype(value, "Object", Object.prototype) && prototype !== null)) throw new Error(`${path}: ${value.constructor?.name ?? "custom"} instances/live handles cannot transfer; retain plain data or an exact module import`);
				const properties: Record<string, PortableValue> = {};
				for (const key of Reflect.ownKeys(value)) {
					if (typeof key !== "string") throw new Error(`${path}: symbol properties cannot transfer`);
					if (Array.isArray(value) && key === "length") continue;
					const descriptor = Object.getOwnPropertyDescriptor(value, key);
					if (!descriptor || !("value" in descriptor) || !descriptor.writable || !descriptor.enumerable || !descriptor.configurable) throw new Error(`${path}.${key}: accessors/nonstandard descriptors cannot transfer; store plain data`);
					Object.defineProperty(properties, key, { value: visit(descriptor.value, `${path}.${key}`), enumerable: true, writable: true, configurable: true });
				}
				state.nodes[id] = Array.isArray(value) ? { kind: "array", length: value.length, properties } : { kind: "object", nullPrototype: prototype === null, properties };
			}
			return { ref: id };
		};
		for (const [name, value] of Object.entries(values)) Object.defineProperty(state.roots, name, { value: visit(value, name), enumerable: true, configurable: true, writable: true });
		return state;
	}

	decode(state: PortableState, resolveRecipe: (name: string) => unknown, resolveModule: (node: Extract<PortableNode, { kind: "module" }>) => unknown = () => { throw new Error("Module recipe resolver unavailable"); }): { values: Record<string, unknown>; restoreCheckpoints(resolve: (name: string) => unknown): Promise<void> } {
		const objects = new Map<string, unknown>();
		for (const [id, node] of Object.entries(state.nodes)) {
			let value: unknown;
			switch (node.kind) {
				case "array": value = this.create("Array", Array, [node.length]); break;
				case "object": value = node.nullPrototype ? Object.create(null) : this.create("Object", Object, []); break;
				case "map": value = this.create("Map", Map, []); break;
				case "set": value = this.create("Set", Set, []); break;
				case "binary": {
					const decoded: unknown = deserialize(node.bytes);
					if (!types.isArrayBuffer(decoded)) throw new Error("Invalid TS binary buffer");
					const buffer = this.create<ArrayBuffer>("ArrayBuffer", ArrayBuffer, [decoded.byteLength]);
					new Uint8Array(buffer).set(new Uint8Array(decoded));
					value = buffer; break;
				}
				case "date": value = this.create("Date", Date, [node.time]); break;
				case "regexp": { const expression = this.create<RegExp>("RegExp", RegExp, [node.source, node.flags]); expression.lastIndex = node.lastIndex; value = expression; break; }
				case "recipe": value = resolveRecipe(node.name); this.registerRecipe(value, node.name); break;
				case "module": value = resolveModule(node); this.registerModule(value, node.specifier, node.imported, node.attributes); break;
				case "view": continue;
				case "checkpoint": value = undefined; break;
			}
			objects.set(id, value);
			if ((typeof value === "object" && value !== null) || typeof value === "function") this.identities.set(value, id);
		}
		const read = (value: PortableValue): unknown => {
			if (value !== null && typeof value === "object") {
				if (!objects.has(value.ref)) throw new Error(`Missing portable object ${value.ref}`);
				return objects.get(value.ref);
			}
			return value;
		};
		for (const [id, node] of Object.entries(state.nodes)) {
			if (node.kind !== "view") continue;
			const buffer = read(node.buffer);
			if (!types.isArrayBuffer(buffer)) throw new Error("Invalid typed-array buffer");
			const constructors: Record<string, new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView> = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
			if (node.constructor === "Buffer") {
				const object = Buffer.from(buffer, node.byteOffset, node.length);
				objects.set(id, object); this.identities.set(object, id); continue;
			}
			const Constructor = constructors[node.constructor];
			if (!Constructor) throw new Error(`Unsupported typed array ${node.constructor}`);
			const object = this.create<ArrayBufferView>(node.constructor, Constructor, [buffer, node.byteOffset, node.length]);
			objects.set(id, object);
			this.identities.set(object, id);
		}
		const fill = (restored = false): void => { for (const [id, node] of Object.entries(state.nodes)) {
			const pending = (value: PortableValue): boolean => value !== null && typeof value === "object" && state.nodes[value.ref]?.kind === "checkpoint";
			if (restored && !(node.kind === "object" || node.kind === "array" || node.kind === "recipe" ? Object.values(node.properties).some(pending) : node.kind === "map" ? node.entries.some(([key, value]) => pending(key) || pending(value)) : node.kind === "set" && node.entries.some(pending))) continue;
			const object = objects.get(id);
			if (node.kind === "object" || node.kind === "array" || node.kind === "recipe") {
				if ((typeof object !== "object" || object === null) && typeof object !== "function") throw new Error("Invalid portable object");
				for (const [key, value] of Object.entries(node.properties)) Object.defineProperty(object, key, { value: read(value), writable: true, enumerable: true, configurable: true });
			} else if (node.kind === "map" && types.isMap(object)) { object.clear(); for (const [key, value] of node.entries) object.set(read(key), read(value)); }
			else if (node.kind === "set" && types.isSet(object)) { object.clear(); for (const value of node.entries) object.add(read(value)); }
		} };
		fill();
		const values = Object.fromEntries(Object.entries(state.roots).map(([name, value]) => [name, read(value)]));
		return { values, restoreCheckpoints: async resolve => {
			for (const [id, node] of Object.entries(state.nodes)) {
				if (node.kind !== "checkpoint") continue;
				const restore = resolve(node.restore);
				if (typeof restore !== "function") throw new Error(`TS restore helper ${node.restore} is unavailable`);
				let value: unknown;
				try { value = await restore(read(node.data)); }
				catch (cause) { throw new CheckpointRestoreError(`TS restore ${node.restore} failed: ${cause instanceof Error ? cause.message : String(cause)}`, ownersOfNode(state, id)); }
				if ((typeof value !== "object" || value === null) && typeof value !== "function") throw new CheckpointRestoreError(`TS restore ${node.restore} must return an object or function`, ownersOfNode(state, id));
				objects.set(id, value); this.identities.set(value, id);
			}
			fill(true);
			for (const [name, value] of Object.entries(state.roots)) values[name] = read(value);
		} };
	}
}

export function bindingDependencies(binding: BindingRecipe): string[] {
	return [...(binding.references ?? []), ...(binding.checkpoint ? [binding.checkpoint.snapshot, binding.checkpoint.restore] : [])];
}

function descriptors(value: object): Map<PropertyKey, PropertyDescriptor> { return new Map(Reflect.ownKeys(value).map(key => [key, Object.getOwnPropertyDescriptor(value, key) ?? {}])); }
function sameDescriptors(value: object, expected: Map<PropertyKey, PropertyDescriptor>, allowAdditional = false): boolean {
	const keys = [...expected.keys()];
	return (allowAdditional || Reflect.ownKeys(value).length === expected.size) && keys.every(key => {
		const before = expected.get(key);
		const after = Object.getOwnPropertyDescriptor(value, key);
		return before && after && before.value === after.value && before.get === after.get && before.set === after.set && before.writable === after.writable && before.enumerable === after.enumerable && before.configurable === after.configurable;
	});
}
