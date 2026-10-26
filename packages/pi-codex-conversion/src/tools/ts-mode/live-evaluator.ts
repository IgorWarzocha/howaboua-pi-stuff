import { start, type REPLServer } from "node:repl";
import { PassThrough, Writable } from "node:stream";
import { AsyncLocalStorage } from "node:async_hooks";
import { runInContext } from "node:vm";
import { Console } from "node:console";
import { RealmValues } from "./realm-values.ts";

/** Public Node REPL evaluation preserves lexical bindings, including across top-level await. */
export class LiveEvaluator {
	readonly intrinsics: Record<string, Function>;
	readonly values: RealmValues;
	private readonly repl: REPLServer;
	private failure: ((error: unknown) => void) | undefined;
	private busy = false;
	private readonly evaluations = new AsyncLocalStorage<symbol>();
	private active: symbol | undefined;

	constructor(output: (text: string) => void = () => {}) {
		this.repl = start({
			input: new PassThrough(), output: new PassThrough(), terminal: false, useGlobal: false,
			// REPL runtime exceptions go to its writer, not the eval callback.
			writer: value => {
				if (this.evaluations.getStore() === this.active) this.failure?.(value);
				return "";
			},
		});
		const intrinsics: unknown = runInContext("({Object,Array,Map,Set,Date,RegExp,ArrayBuffer,Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView,Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,AggregateError})", this.repl.context);
		assertIntrinsics(intrinsics);
		this.intrinsics = intrinsics;
		this.values = new RealmValues(intrinsics);
		const stream = new Writable({ write(chunk: Buffer, _encoding, done) { output(chunk.toString("utf8")); done(); } });
		this.install({ console: new Console({ stdout: stream, stderr: stream, colorMode: false }) });
	}

	async evaluate(source: string): Promise<unknown> {
		if (this.busy) throw new Error("A TS live cell is already executing");
		this.busy = true;
		this.active = Symbol();
		try {
			return await this.evaluations.run(this.active, () => new Promise<unknown>((resolve, reject) => {
				this.failure = reject;
				// Cells are statements: stop REPL object-literal guessing on leading blocks,
				// which breaks block-local declarations containing top-level await.
				this.repl.eval(`${source}\n;`, this.repl.context, "ts-cell", (error: Error | null, value: unknown) => {
					if (error) reject(error); else resolve(value);
				});
			}));
		} finally { this.failure = undefined; this.busy = false; this.active = undefined; }
	}

	install(values: Record<string, unknown>): void { Object.assign(this.repl.context, values); }
}

function assertIntrinsics(value: unknown): asserts value is Record<string, Function> {
	if (typeof value !== "object" || value === null) throw new Error("TS could not prepare its lexical environment");
	for (const constructor of Object.values(value)) {
		if (typeof constructor !== "function" || typeof Reflect.get(constructor, "prototype") !== "object" || Reflect.get(constructor, "prototype") === null) throw new Error("TS could not prepare its lexical intrinsics");
	}
}
