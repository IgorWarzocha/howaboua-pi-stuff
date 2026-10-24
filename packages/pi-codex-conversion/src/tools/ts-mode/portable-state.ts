import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";

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
	| { kind: "module"; specifier: string; imported: string; attributes?: Record<string, string> | undefined };

export interface BindingRecipe {
	name: string;
	kind: string;
	declaration: string;
	source?: string | undefined;
	references?: string[] | undefined;
	module?: { specifier: string; imported: string; attributes?: Record<string, string> | undefined } | undefined;
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
	private readonly identities = new WeakMap<object, string>();
	private readonly recipes = new Map<object, { name: string; descriptors: Map<PropertyKey, PropertyDescriptor>; prototypeDescriptors?: Map<PropertyKey, PropertyDescriptor> | undefined }>();
	private readonly modules = new Map<object, Extract<PortableNode, { kind: "module" }>>();

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
			if (value instanceof Map || value instanceof Set || value instanceof Date || value instanceof RegExp || value instanceof ArrayBuffer) {
				const expected = value instanceof Map ? Map.prototype : value instanceof Set ? Set.prototype : value instanceof Date ? Date.prototype : value instanceof RegExp ? RegExp.prototype : ArrayBuffer.prototype;
				if (Object.getPrototypeOf(value) !== expected) throw new Error(`${path}: custom built-in subclasses cannot transfer; store ordinary built-in values`);
				const unexpected = Reflect.ownKeys(value).filter(key => !(value instanceof RegExp && key === "lastIndex"));
				if (unexpected.length) throw new Error(`${path}: extra properties on built-in values cannot transfer; store them separately`);
			}
			if (value instanceof Map) state.nodes[id] = { kind: "map", entries: [...value].map(([key, item], i) => [visit(key, `${path}.key${i}`), visit(item, `${path}.value${i}`)]) };
			else if (value instanceof Set) state.nodes[id] = { kind: "set", entries: [...value].map((item, i) => visit(item, `${path}[${i}]`)) };
			else if (value instanceof Date) state.nodes[id] = { kind: "date", time: value.getTime() };
			else if (value instanceof RegExp) state.nodes[id] = { kind: "regexp", source: value.source, flags: value.flags, lastIndex: value.lastIndex };
			else if (value instanceof ArrayBuffer) {
				if (value.resizable) throw new Error(`${path}: resizable buffers cannot transfer; use a fixed ArrayBuffer`);
				state.nodes[id] = { kind: "binary", bytes: serialize(value) };
			}
			else if (ArrayBuffer.isView(value)) {
				if (!(value.buffer instanceof ArrayBuffer)) throw new Error(`${path}: shared buffers cannot transfer safely`);
				const constructors = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView, Buffer];
				const Constructor = constructors.find(candidate => Object.getPrototypeOf(value) === candidate.prototype);
				if (!Constructor) throw new Error(`${path}: custom typed-array subclasses cannot transfer`);
				const bytes: unknown = Reflect.get(Constructor, "BYTES_PER_ELEMENT");
				const length = value instanceof DataView ? value.byteLength : typeof bytes === "number" ? value.byteLength / bytes : 0;
				if (Object.getOwnPropertyNames(value).length !== (value instanceof DataView ? 0 : length)) throw new Error(`${path}: extra typed-array properties cannot transfer`);
				if (Object.getOwnPropertySymbols(value).length) throw new Error(`${path}: symbol properties cannot transfer`);
				state.nodes[id] = { kind: "view", constructor: Constructor.name, buffer: visit(value.buffer, `${path}.buffer`), byteOffset: value.byteOffset, length };
			}
			else {
				const prototype: unknown = Object.getPrototypeOf(value);
				if ((Array.isArray(value) && prototype !== Array.prototype) || (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)) throw new Error(`${path}: ${value.constructor?.name ?? "custom"} instances/live handles cannot transfer; retain plain data or an exact module import`);
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

	decode(state: PortableState, resolveRecipe: (name: string) => unknown, resolveModule: (node: Extract<PortableNode, { kind: "module" }>) => unknown = () => { throw new Error("Module recipe resolver unavailable"); }): Record<string, unknown> {
		const objects = new Map<string, unknown>();
		for (const [id, node] of Object.entries(state.nodes)) {
			let value: unknown;
			switch (node.kind) {
				case "array": value = new Array(node.length); break;
				case "object": value = node.nullPrototype ? Object.create(null) : {}; break;
				case "map": value = new Map(); break;
				case "set": value = new Set(); break;
				case "binary": value = deserialize(node.bytes); break;
				case "date": value = new Date(node.time); break;
				case "regexp": { const expression = new RegExp(node.source, node.flags); expression.lastIndex = node.lastIndex; value = expression; break; }
				case "recipe": value = resolveRecipe(node.name); this.registerRecipe(value, node.name); break;
				case "module": value = resolveModule(node); this.registerModule(value, node.specifier, node.imported, node.attributes); break;
				case "view": continue;
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
			if (!(buffer instanceof ArrayBuffer)) throw new Error("Invalid typed-array buffer");
			const constructors: Record<string, new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView> = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView };
			if (node.constructor === "Buffer") {
				const object = Buffer.from(buffer, node.byteOffset, node.length);
				objects.set(id, object); this.identities.set(object, id); continue;
			}
			const Constructor = constructors[node.constructor];
			if (!Constructor) throw new Error(`Unsupported typed array ${node.constructor}`);
			const object = new Constructor(buffer, node.byteOffset, node.length);
			objects.set(id, object);
			this.identities.set(object, id);
		}
		for (const [id, node] of Object.entries(state.nodes)) {
			const object = objects.get(id);
			if (node.kind === "object" || node.kind === "array" || node.kind === "recipe") {
				if ((typeof object !== "object" || object === null) && typeof object !== "function") throw new Error("Invalid portable object");
				for (const [key, value] of Object.entries(node.properties)) Object.defineProperty(object, key, { value: read(value), writable: true, enumerable: true, configurable: true });
			} else if (node.kind === "map" && object instanceof Map) for (const [key, value] of node.entries) object.set(read(key), read(value));
			else if (node.kind === "set" && object instanceof Set) for (const value of node.entries) object.add(read(value));
		}
		return Object.fromEntries(Object.entries(state.roots).map(([name, value]) => [name, read(value)]));
	}
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

function same(left: unknown, right: unknown): boolean { return serialize(left).equals(serialize(right)); }

/** Three-way merge is synchronous; the client persists before publishing this candidate. */
export function mergeState(start: PortableState, current: PortableState, candidate: PortableState): { state: PortableState; conflicts: string[] } {
	const state: PortableState = deserialize(serialize(current));
	const conflicts: string[] = [];
	for (const field of ["roots", "nodes", "bindings"] as const) {
		const before: Record<string, unknown> = start[field];
		const latest: Record<string, unknown> = current[field];
		const proposed: Record<string, unknown> = candidate[field];
		const merged: Record<string, unknown> = state[field];
		for (const key of new Set([...Object.keys(before), ...Object.keys(proposed)])) {
			if (same(before[key], proposed[key])) continue;
			if (!same(before[key], latest[key])) { conflicts.push(field === "nodes" ? `shared data (${ownersOfNode(current, key).join(", ") || "retained value"})` : `binding ${key}`); continue; }
			if (Object.hasOwn(proposed, key)) Object.defineProperty(merged, key, { value: proposed[key], enumerable: true, writable: true, configurable: true });
			else delete merged[key];
		}
	}
	state.pins = [...new Set([...current.pins.filter(name => !start.pins.includes(name) || candidate.pins.includes(name)), ...candidate.pins.filter(name => !start.pins.includes(name))])];
	state.imports = [...new Set([...current.imports, ...candidate.imports])];
	return { state, conflicts };
}

function ownersOfNode(state: PortableState, target: string): string[] {
	return Object.entries(state.roots).filter(([, root]) => {
		const seen = new Set<string>();
		const contains = (value: PortableValue): boolean => {
			if (value === null || typeof value !== "object" || seen.has(value.ref)) return false;
			if (value.ref === target) return true;
			seen.add(value.ref);
			const node = state.nodes[value.ref];
			if (node?.kind === "object" || node?.kind === "array" || node?.kind === "recipe") return Object.values(node.properties).some(contains);
			if (node?.kind === "map") return node.entries.some(([key, item]) => contains(key) || contains(item));
			if (node?.kind === "set") return node.entries.some(contains);
			if (node?.kind === "view") return contains(node.buffer);
			return false;
		};
		return contains(root);
	}).map(([name]) => name);
}

export function compactState(state: PortableState): PortableState {
	const reachable = new Set<string>();
	const visit = (value: PortableValue): void => {
		if (value === null || typeof value !== "object" || reachable.has(value.ref)) return;
		reachable.add(value.ref);
		const node = state.nodes[value.ref];
		if (!node) throw new Error(`Missing portable object ${value.ref}`);
		if (node.kind === "object" || node.kind === "array" || node.kind === "recipe") Object.values(node.properties).forEach(visit);
		else if (node.kind === "map") node.entries.forEach(([key, item]) => { visit(key); visit(item); });
		else if (node.kind === "set") node.entries.forEach(visit);
		else if (node.kind === "view") visit(node.buffer);
	};
	Object.values(state.roots).forEach(visit);
	state.nodes = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => reachable.has(id)));
	return state;
}
