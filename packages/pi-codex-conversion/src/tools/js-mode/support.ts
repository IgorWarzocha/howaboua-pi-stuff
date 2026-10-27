import { randomUUID } from "node:crypto";
import type { JSValueHandle, QuickJS } from "quickjs-wasi";
import type { NotebookHook } from "../code-mode/types.ts";
import { validJsBindingName } from "./bindings.ts";

// Separate from the immutable boot controller so legacy images need no replay.
export const JS_SUPPORT_SOURCE = String.raw`(namespace => {
  const ids = new WeakMap(), hooks = new Map(), extensible = Object.isExtensible, parse = JSON.parse;
  const queue = [], settlements = [];
  let next = 0, depth = 0, failure, pumping = false;
  const describe = e => { try { return String(e); } catch { return 'unknown error'; } };
  return {
    isExtensible(value) { return extensible(value); },
    event(json) { return parse(json); },
    identity(value, supplied) {
      if ((typeof value !== 'object' || value === null) && typeof value !== 'function') throw new TypeError('Graph identity requires an object');
      let id = ids.get(value);
      if (supplied !== undefined) { if (id !== undefined && id !== supplied) throw new Error('Graph identity conflict'); id = supplied; }
      if (id === undefined) id = namespace + ':' + (++next);
      ids.set(value, id); return id;
    },
    register(name, event, fn) { if (event === false) hooks.delete(name); else { if (typeof fn !== 'function') throw new TypeError('Hook requires an existing function'); hooks.set(name, {event, fn}); } },
    list() { return JSON.stringify([...hooks].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([name,h]) => ({name,event:h.event}))); },
    depth() { return depth; },
    failure() { const result = failure; failure = undefined; return result; },
    async dispatch(event) {
      const kind = event.type;
      depth++;
      try { for (const [name,h] of [...hooks].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) if (h.event === kind) {
        try { await h.fn(event); } catch (e) { throw new Error('Notebook ' + kind + ' hook ' + name + ' failed: ' + describe(e) + '. Remove it with notebook hook event:false; live state was retained'); }
      } } finally { depth--; }
    },
    settle(control, id, json, error, event) {
      queue.push({control,id,json,error,event});
      if (pumping) return;
      pumping = true;
      const pump = async () => {
        while (queue.length) {
          const request = queue.shift();
          try { await this.dispatch(request.event); }
          catch (e) { failure = describe(e); request.json = ''; request.error = failure; }
          settlements.push(request);
        }
        // No user continuation resumes inside another event's hooks. Together
        // with the fully drained VM job queue this makes depth hook-local,
        // without patching Promise or replacing the immutable tools helpers.
        pumping = false;
        for (const request of settlements.splice(0)) request.control.settle(request.id,request.json,request.error);
      };
      pump();
    }
  };
})`;

export class JsSupport {
	readonly token: number;
	private readonly vm: QuickJS;
	constructor(vm: QuickJS, token?: number) {
		this.vm = vm;
		if (token !== undefined) {
			this.token = token;
			return;
		}
		const factory = vm.evalCode(JS_SUPPORT_SOURCE, "js-notebook-support.js"),
			namespace = vm.newString(randomUUID());
		// The exported box is the one permanent support root, reclaimed with the VM.
		try {
			const root = vm.callFunction(factory, vm.undefined, namespace);
			this.token = vm.exportHandle(root);
		} finally {
			factory.dispose();
			namespace.dispose();
		}
	}
	call(name: string, ...args: JSValueHandle[]): JSValueHandle {
		const root = this.vm.importHandle(this.token),
			fn = root.getProp(name);
		try {
			return this.vm.callFunction(fn, root, ...args);
		} finally {
			fn.dispose();
			root.dispose();
		}
	}
	identity(value: JSValueHandle, suppliedId?: string): string {
		const supplied =
			suppliedId === undefined
				? this.vm.undefined
				: this.vm.newString(suppliedId);
		try {
			return this.call("identity", value, supplied).consume((id) =>
				id.toString(),
			);
		} finally {
			supplied.dispose();
		}
	}
	isExtensible(value: JSValueHandle): boolean {
		return this.call("isExtensible", value).consume((result) =>
			result.toBoolean(),
		);
	}
	register(name: string, event: NotebookHook | false, fn: JSValueHandle): void {
		if (!validJsBindingName(name))
			throw new Error("Hook name must be a binding identifier");
		const key = this.vm.newString(name),
			kind = event === false ? this.vm.false : this.vm.newString(event);
		try {
			this.call("register", key, kind, fn).dispose();
		} finally {
			key.dispose();
			kind.dispose();
		}
	}
}
