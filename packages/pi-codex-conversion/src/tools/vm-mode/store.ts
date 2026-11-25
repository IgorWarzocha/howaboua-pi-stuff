import { VM_STORE_TOTAL_MAX, VM_STORE_VALUE_MAX } from "./limits.ts";

/** Host-owned JSON, separate from guest bindings and retained across in-session restarts. */
export class VmStore {
	private readonly values = new Map<string, string>();

	snapshot(): Record<string, string> {
		return Object.fromEntries(this.values);
	}

	set(key: string, json?: string): void {
		let size = json === undefined ? 0 : key.length + json.length;
		for (const [name, value] of this.values)
			if (name !== key) size += name.length + value.length;
		if (json !== undefined && json.length > VM_STORE_VALUE_MAX)
			throw new Error("Stored value is too large; store less data");
		if (size > VM_STORE_TOTAL_MAX)
			throw new Error("Store is full; delete keys with store(key, undefined)");
		if (json === undefined) this.values.delete(key);
		else this.values.set(key, json);
	}

	clear(): void {
		this.values.clear();
	}

	describeRetainedKeys(): string {
		if (!this.values.size) return "No stored values.";
		const shown: string[] = [];
		for (const key of this.values.keys()) {
			if (shown.length === 8) break;
			if (key.length <= 80) shown.push(JSON.stringify(key));
		}
		const omitted = this.values.size - shown.length;
		if (omitted) shown.push(`${omitted} more`);
		return `Stored keys kept: ${shown.join(", ")}. Use load("key").`;
	}
}
