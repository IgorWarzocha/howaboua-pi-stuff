import { types } from "node:util";

const ERROR_NAMES = new Set(["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError"]);

/** IPC and hook events are data, not durable recipes; clone them into the cell's realm. */
export class RealmValues {
	private readonly constructors: Readonly<Record<string, Function>>;
	constructor(constructors: Readonly<Record<string, Function>>) { this.constructors = constructors; }

	error(value: unknown): unknown {
		return this.clone(types.isNativeError(value) ? value : new Error(String(value)));
	}

	clone(value: unknown): unknown {
		const seen = new Map<object, unknown>();
		const create = (name: string, args: unknown[]): object => {
			const constructor = this.constructors[name];
			if (!constructor) throw new Error(`This TS value cannot be copied (${name}); use plain data instead`);
			return Reflect.construct(constructor, args);
		};
		const copy = (value: unknown): unknown => {
			if (typeof value === "symbol") throw new Error("Symbols cannot be copied into a TS cell; use plain data instead");
			if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
			if (typeof value === "function") throw new Error("Functions cannot be copied into a TS cell; use plain data instead");
			if (types.isSharedArrayBuffer(value) || types.isWeakMap(value) || types.isWeakSet(value) || types.isPromise(value)) throw new Error("This value cannot be copied into a TS cell; use settled plain data or ordinary containers instead");
			if (seen.has(value)) return seen.get(value);
			let result: object;
			if (types.isMap(value)) {
				result = create("Map", []); seen.set(value, result);
				for (const [key, item] of value) Map.prototype.set.call(result, copy(key), copy(item));
				return result;
			}
			if (types.isSet(value)) {
				result = create("Set", []); seen.set(value, result);
				for (const item of value) Set.prototype.add.call(result, copy(item));
				return result;
			}
			if (types.isArrayBuffer(value)) {
				result = create("ArrayBuffer", [value.byteLength]); seen.set(value, result);
				if (!types.isArrayBuffer(result)) throw new Error("TS could not receive binary data");
				new Uint8Array(result).set(new Uint8Array(value));
				return result;
			}
			if (ArrayBuffer.isView(value)) {
				const buffer = copy(value.buffer);
				if (!types.isArrayBuffer(buffer)) throw new Error("Shared buffers cannot be copied into a TS cell; use a fixed ArrayBuffer instead");
				if (Buffer.isBuffer(value)) result = Buffer.from(buffer, value.byteOffset, value.byteLength);
				else if (types.isDataView(value)) result = create("DataView", [buffer, value.byteOffset, value.byteLength]);
				else {
					const name = Object.prototype.toString.call(value).slice(8, -1);
					result = create(name, [buffer, value.byteOffset, Reflect.get(value, "length")]);
				}
				seen.set(value, result); return result;
			}
			if (types.isDate(value)) result = create("Date", [value.getTime()]);
			else if (types.isRegExp(value)) { result = create("RegExp", [value.source, value.flags]); Reflect.set(result, "lastIndex", value.lastIndex); }
			else if (types.isNativeError(value)) {
				const name = ERROR_NAMES.has(value.name) ? value.name : "Error";
				result = create(name, name === "AggregateError" ? [[], value.message] : [value.message]);
				seen.set(value, result);
				for (const key of ["name", "message", "stack", "cause", "errors"]) if (Object.hasOwn(value, key)) Object.defineProperty(result, key, { value: copy(Reflect.get(value, key)), writable: true, configurable: true });
			}
			else result = Array.isArray(value) ? create("Array", [value.length]) : Object.getPrototypeOf(value) === null ? Object.create(null) : create("Object", []);
			seen.set(value, result);
			for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: copy(Reflect.get(value, key)), enumerable: true, writable: true, configurable: true });
			return result;
		};
		return copy(value);
	}
}
