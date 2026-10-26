import type { JSValueHandle, QuickJS } from "quickjs-wasi";
import type { JsBindingStatus, JsDeclaration, JsInventory } from "./protocol.ts";
import { managedCell } from "./managed-source.ts";

// A binding record is captured individually by later cells. Removing the
// public name drops only the registry's reference, not surviving closures.
export const JS_BINDINGS_SOURCE = String.raw`(() => {
  const records = new Map(), pending = new Map(), masked = new Set(), global = globalThis, nativeEval = eval;
  const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const stringify = JSON.stringify;
  const missing = name => { throw new ReferenceError(name + ' is not defined'); };
  const nativeRead = name => masked.has(name) ? missing(name) : descriptor(global,name) ? global[name] : nativeEval(name);
  const nativeType = name => masked.has(name) ? 'undefined' : descriptor(global,name) ? typeof global[name] : nativeEval('typeof '+name);
  const create = name => {
    let assign;
    const record = {kind:undefined,get:()=>nativeRead(name),set:value=>{
      if(masked.has(name))return missing(name);
      if(!assign){const parameter=name==='__notebook_value'?'__notebook_next':'__notebook_value';assign=nativeEval('('+parameter+')=>'+name+'='+parameter)}
      return assign(value);
    }};
    define(record,'value',{get:()=>record.get(),set:value=>{
      if(!record.set)throw new TypeError('Assignment to constant binding '+name);
      return record.set(value);
    }});
    define(record,'type',{get:()=>record.kind ? typeof record.get() : nativeType(name)});
    record.delete=()=>record.kind ? false : masked.has(name) ? true : nativeEval('delete '+name);
    return record;
  };
  return {
    install(name, kind, get, set, legacy = false) {
      if (records.has(name)) throw new SyntaxError('Binding already exists: ' + name);
      const record = pending.get(name) || create(name); pending.delete(name);
      record.kind=kind;record.get=get;record.set=set;record.legacy=legacy;
      records.set(name, record);
      if (!legacy && (kind === 'var' || kind === 'function') && !(masked.has(name) && descriptor(global,name)?.configurable === false)) define(global, name, {get, set: record.set, enumerable:true, configurable:true});
    },
    add(name, kind, value) { this.install(name, kind, () => value, kind === 'const' ? undefined : next => { value = next; }); },
    validate(json) {
      for (const {name,kind} of JSON.parse(json)) {
        if (records.has(name)) throw new SyntaxError('Binding already exists: ' + name);
        if ((kind === 'var' || kind === 'function') && !masked.has(name) && descriptor(global,name)?.configurable === false) throw new SyntaxError('Global name is reserved: ' + name);
      }
    },
    ref(name) { let record=records.get(name)||pending.get(name);if(!record){record=create(name);pending.set(name,record)}return record; },
    has(name) { return records.has(name); },
    masked(name) { return masked.has(name); },
    read(name) { const value = records.get(name); return value ? value.get() : missing(name); },
    remove(name) {
      const record = records.get(name);
      if (!record) return false;
      if (record.legacy) masked.add(name);
      const current = descriptor(global,name);
      if (!record.legacy && current?.get === record.get && current.configurable) delete global[name];
      records.delete(name); return record.legacy;
    },
    metadata() { return stringify({declarations:[...records].map(([name,r])=>({name,kind:r.kind})),masked:[...masked]}); },
    inspect() { return stringify({bindings:[...records].map(([name,r])=>{let type;try{type=typeof r.get()}catch{type='unavailable'}return {name,kind:r.kind,type}}),masked:[...masked]}); },
    legacyGlobal(name) { const item=descriptor(global,name); if (!item || !('value' in item)) throw new ReferenceError(name+' is unavailable'); return item.value; }
  };
})()`;

export class JsBindings {
	readonly token: number;
	private readonly vm: QuickJS;
	constructor(vm: QuickJS, inventory: JsInventory, token?: number) {
		this.vm = vm;
		if (token !== undefined) { this.token = token; return; }
		this.token = vm.exportHandle(vm.evalCode(JS_BINDINGS_SOURCE, "js-notebook-bindings.js"));
		// Legacy images keep their original heap. Capturing their native bindings
		// preserves old closures; removed names are masked in future managed cells.
		for (const { name, kind } of inventory.declarations) {
			const key = vm.newString(name), type = vm.newString(kind), legacy = vm.true;
			let getter: JSValueHandle | undefined, setter: JSValueHandle | undefined;
			try {
				if (kind === "var" || kind === "function") {
					const root = vm.importHandle(this.token), factory = vm.evalCode(`root=>()=>root.legacyGlobal(${JSON.stringify(name)})`);
					try { getter = vm.callFunction(factory, vm.undefined, root); } finally { root.dispose(); factory.dispose(); }
				} else getter = vm.evalCode(`()=>${name}`);
				const parameter = name === "__notebook_value" ? "__notebook_next" : "__notebook_value";
				setter = ["const", "using", "await using"].includes(kind) ? vm.undefined : vm.evalCode(`${parameter}=>${name}=${parameter}`);
				this.call("install", key, type, getter, setter, legacy).dispose();
			} finally { key.dispose(); type.dispose(); legacy.dispose(); getter?.dispose(); setter?.dispose(); }
		}
	}
	call(name: string, ...args: JSValueHandle[]): JSValueHandle {
		const root = this.vm.importHandle(this.token), fn = root.getProp(name);
		try { return this.vm.callFunction(fn, root, ...args); } finally { fn.dispose(); root.dispose(); }
	}
	private named(name: string, action: string): JSValueHandle {
		const key = this.vm.newString(name);
		try { return this.call(action, key); } finally { key.dispose(); }
	}
	has(name: string): boolean { return this.named(name, "has").consume(value => value.toBoolean()); }
	isMasked(name: string): boolean { return this.named(name, "masked").consume(value => value.toBoolean()); }
	read(name: string): JSValueHandle { return this.named(name, "read"); }
	remove(name: string): boolean { return this.named(name, "remove").consume(value => value.toBoolean()); }
	inspect(): { bindings: JsBindingStatus[]; masked: string[] } { return this.call("inspect").consume(value => JSON.parse(value.toString())); }
	add(name: string, kind: "var" | "let" | "const", value: JSValueHandle): void {
		const key = this.vm.newString(name), type = this.vm.newString(kind);
		try { this.call("add", key, type, value).dispose(); } finally { key.dispose(); type.dispose(); }
	}
	execute(source: string): JSValueHandle {
		const metadata: { declarations: JsDeclaration[]; masked: string[] } = this.call("metadata").consume(value => JSON.parse(value.toString()));
		const compiled = managedCell(source, new Map(metadata.declarations.map(binding => [binding.name, binding.kind])));
		const fn = this.vm.evalCode(compiled.source, "js-notebook-cell.js");
		const root = this.vm.importHandle(this.token), references: JSValueHandle[] = [], json = this.vm.newString(JSON.stringify(compiled.declarations));
		try {
			this.call("validate", json).dispose();
			for (const name of compiled.references) references.push(this.named(name, "ref"));
			return this.vm.callFunction(fn, this.vm.undefined, root, ...references);
		} finally { fn.dispose(); root.dispose(); json.dispose(); for (const value of references) value.dispose(); }
	}
}
