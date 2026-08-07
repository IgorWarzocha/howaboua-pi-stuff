import type { KernelExecutionResult } from "./jupyter-kernel.ts";

export interface NotebookBindingStatus {
	name: string;
	type: string;
	constructor?: string | undefined;
	persistence: "value" | "definition" | "runtime-only";
	disposable?: "sync" | "async" | undefined;
}

export interface NotebookKernelStatus {
	memory: {
		heapUsedBytes: number;
		heapTotalBytes: number;
		heapLimitBytes: number;
		rssBytes: number;
		externalBytes: number;
	};
	bindings: NotebookBindingStatus[];
}

export interface NotebookReleaseResult {
	released: string[];
	disposed: string[];
	failures: Array<{ name: string; reason: string }>;
}

export function notebookStatusSource(names: string[], marker: string): string {
	const inspections = names.map((name) => `
  try {
    const __value = ${name};
    let __persistence = "value";
    let __disposable;
    if ((__value !== null && (typeof __value === "object" || typeof __value === "function"))) {
      if (typeof __value[Symbol.asyncDispose] === "function") __disposable = "async";
      else if (typeof __value[Symbol.dispose] === "function") __disposable = "sync";
    }
    if (__disposable || __value instanceof Promise || __value instanceof WeakMap || __value instanceof WeakSet) {
      __persistence = "runtime-only";
    } else if (typeof __value === "function") {
      const __source = Function.prototype.toString.call(__value);
      __persistence = __source.includes("[native code]") ? "runtime-only" : "definition";
    } else {
      try { serialize(__value); } catch { __persistence = "runtime-only"; }
    }
    __bindings.push({
      name: ${JSON.stringify(name)},
      type: typeof __value,
      ...(__value?.constructor?.name ? { constructor: String(__value.constructor.name) } : {}),
      persistence: __persistence,
      ...(__disposable ? { disposable: __disposable } : {}),
    });
  } catch (__error) {
    __bindings.push({ name: ${JSON.stringify(name)}, type: "unavailable", persistence: "runtime-only" });
  }`).join("");
	return `{
  const { serialize, getHeapStatistics } = await import("node:v8");
  const __bindings = [];
  ${inspections}
  const __memory = Deno.memoryUsage();
  console.log(${JSON.stringify(marker)} + JSON.stringify({
    memory: {
      heapUsedBytes: __memory.heapUsed,
      heapTotalBytes: __memory.heapTotal,
      heapLimitBytes: getHeapStatistics().heap_size_limit,
      rssBytes: __memory.rss,
      externalBytes: __memory.external,
    },
    bindings: __bindings,
  }));
  undefined;
}`;
}

export function notebookReleaseSource(names: string[], marker: string): string {
	return notebookDisposalSource(names, marker, true);
}

export function notebookDisposeSource(names: string[], marker: string): string {
	return notebookDisposalSource(names, marker, false);
}

function notebookDisposalSource(names: string[], marker: string, remove: boolean): string {
	const releases = names.map((name) => `
  try {
    const __value = ${name};
    if (__value !== null && (typeof __value === "object" || typeof __value === "function") && !__seen.has(__value)) {
      __seen.add(__value);
      if (typeof __value[Symbol.asyncDispose] === "function") {
        await __value[Symbol.asyncDispose]();
        __disposed.push(${JSON.stringify(name)});
      } else if (typeof __value[Symbol.dispose] === "function") {
        __value[Symbol.dispose]();
        __disposed.push(${JSON.stringify(name)});
      }
    }
	    ${remove ? `if (!delete globalThis[${JSON.stringify(name)}]) throw new Error("binding is not configurable");
    __released.push(${JSON.stringify(name)});` : ""}
  } catch (__error) {
    __failures.push({ name: ${JSON.stringify(name)}, reason: String(__error instanceof Error ? __error.message : __error).slice(0, 240) });
  }`).join("");
	return `{
  const __seen = new WeakSet();
  const __released = [];
  const __disposed = [];
  const __failures = [];
  ${releases}
  console.log(${JSON.stringify(marker)} + JSON.stringify({ released: __released, disposed: __disposed, failures: __failures }));
  undefined;
}`;
}

export function parseNotebookRuntimeResult<T>(result: KernelExecutionResult, marker: string): T {
	if (result.status !== "ok") throw new Error(result.errorText ?? "Notebook lifecycle operation failed");
	const output = result.items
		.filter((item) => item.type === "input_text")
		.map((item) => item.text ?? "")
		.join("");
	const start = output.indexOf(marker);
	if (start === -1) throw new Error("Notebook lifecycle operation returned no result");
	const line = output.slice(start + marker.length).split("\n", 1)[0];
	try {
		return JSON.parse(line!) as T;
	} catch {
		throw new Error("Notebook lifecycle operation returned an invalid result");
	}
}
