import type { CodeModeToolDefinition } from "../code-mode/types.js";
import { codeModeGlobalName } from "../code-mode/tool-identity.ts";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function literal(value: unknown, ancestors = new Set<object>()): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "unknown";
	if (typeof value !== "object" || ancestors.has(value)) return "unknown";
	const next = new Set(ancestors).add(value);
	if (Array.isArray(value)) return `[${value.map(item => literal(item, next)).join(", ")}]`;
	if (record(value)) return `{ ${Object.entries(value).map(([name, item]) => `${JSON.stringify(name)}: ${literal(item, next)}`).join("; ")} }`;
	return "unknown";
}

function combine(types: string[], operator: "|" | "&"): string {
	const unique = [...new Set(types)];
	return unique.length ? unique.map(type => `(${type})`).join(` ${operator} `) : operator === "|" ? "never" : "unknown";
}

/** Schemas remain runtime admission's authority; unsupported constraints never invent types. */
class SchemaTypes {
	private readonly references = new Map<string, { name: string; schema: unknown }>();
	private readonly root: unknown;
	private readonly prefix: string;
	constructor(root: unknown, prefix: string) {
		this.root = root;
		this.prefix = prefix;
	}

	declaration(): string {
		const declarations = [`type ${this.prefix} = ${this.render(this.root)};`];
		// Rendering a referenced definition can discover further (or recursive) references.
		for (const reference of this.references.values()) declarations.push(`type ${reference.name} = ${this.render(reference.schema)};`);
		return declarations.join("\n");
	}

	private reference(pointer: string): string {
		const existing = this.references.get(pointer);
		if (existing) return existing.name;
		let schema: unknown = this.root;
		if (pointer !== "#" && !pointer.startsWith("#/")) schema = this.namedReference(pointer);
		const parts = pointer.startsWith("#/") ? pointer.slice(2).split("/") : [];
		for (const part of parts) {
			let key: string;
			try { key = decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~"); }
			catch { return "unknown"; }
			if (Array.isArray(schema) && /^(0|[1-9][0-9]*)$/.test(key)) schema = schema[Number(key)];
			else if (record(schema) && Object.hasOwn(schema, key)) schema = schema[key];
			else return "unknown";
		}
		if (schema === undefined) return "unknown";
		const name = `${this.prefix}Ref${this.references.size}`;
		this.references.set(pointer, { name, schema });
		return name;
	}

	private namedReference(name: string): unknown {
		const visited = new Set<object>();
		const visit = (value: unknown): unknown => {
			if (value === null || typeof value !== "object" || visited.has(value)) return undefined;
			visited.add(value);
			if (record(value) && (value["$id"] === name || typeof value["$anchor"] === "string" && `#${value["$anchor"]}` === name)) return value;
			for (const child of Object.values(value)) {
				const found = visit(child);
				if (found !== undefined) return found;
			}
			return undefined;
		};
		return visit(this.root);
	}

	private render(schema: unknown, ancestors = new Set<object>()): string {
		if (schema === false) return "never";
		if (!record(schema) || ancestors.has(schema)) return "unknown";
		const next = new Set(ancestors).add(schema);
		const constraints: string[] = [];
		if (typeof schema["$ref"] === "string") constraints.push(this.reference(schema["$ref"]));
		if (Object.hasOwn(schema, "const")) constraints.push(literal(schema["const"]));
		if (Array.isArray(schema["enum"])) constraints.push(combine(schema["enum"].map(value => literal(value)), "|"));
		for (const keyword of ["anyOf", "oneOf", "allOf"]) {
			const branches = schema[keyword];
			if (Array.isArray(branches)) constraints.push(combine(branches.map(branch => this.render(branch, next)), keyword === "allOf" ? "&" : "|"));
		}
		const type = schema["type"];
		if (Array.isArray(type)) constraints.push(combine(type.map(item => this.typed(item, schema, next)), "|"));
		else if (typeof type === "string") constraints.push(this.typed(type, schema, next));
		else if (record(schema["properties"]) || Object.hasOwn(schema, "additionalProperties")) constraints.push(this.object(schema, next));
		else if (Object.hasOwn(schema, "items") || Array.isArray(schema["prefixItems"])) constraints.push(this.array(schema, next));
		const rendered = combine(constraints, "&");
		return schema["nullable"] === true ? `(${rendered}) | null` : rendered;
	}

	private typed(type: unknown, schema: Record<string, unknown>, ancestors: Set<object>): string {
		switch (type) {
			case "string": return "string";
			case "number": case "integer": return "number";
			case "boolean": return "boolean";
			case "null": return "null";
			case "object": return this.object(schema, ancestors);
			case "array": return this.array(schema, ancestors);
			default: return "unknown";
		}
	}

	private object(schema: Record<string, unknown>, ancestors: Set<object>): string {
		const properties = record(schema["properties"]) ? schema["properties"] : {};
		const required = new Set(Array.isArray(schema["required"]) ? schema["required"].filter(name => typeof name === "string") : []);
		const propertyTypes: string[] = [];
		const fields = Object.entries(properties).map(([name, property]) => {
			const type = this.render(property, ancestors);
			propertyTypes.push(type);
			if (!required.has(name)) propertyTypes.push("undefined");
			return `${JSON.stringify(name)}${required.has(name) ? "" : "?"}: ${type}`;
		});
		for (const name of required) {
			if (!Object.hasOwn(properties, name)) { fields.push(`${JSON.stringify(name)}: unknown`); propertyTypes.push("unknown"); }
		}
		const additional = schema["additionalProperties"];
		const patterns = record(schema["patternProperties"]) ? Object.values(schema["patternProperties"]) : [];
		if (additional !== false || patterns.length) {
			// TS index signatures also cover named fields; include their types to avoid false rejections.
			const extra = additional === false ? [] : [this.render(additional, ancestors)];
			fields.push(`[key: string]: ${combine([...extra, ...patterns.map(pattern => this.render(pattern, ancestors)), ...propertyTypes], "|")}`);
		}
		return fields.length ? `{ ${fields.join("; ")} }` : "Record<string, never>";
	}

	private array(schema: Record<string, unknown>, ancestors: Set<object>): string {
		const items = schema["items"];
		const prefix = Array.isArray(schema["prefixItems"]) ? schema["prefixItems"] : Array.isArray(items) ? items : undefined;
		if (!prefix) return `(${this.render(items, ancestors)})[]`;
		const minimum = typeof schema["minItems"] === "number" ? schema["minItems"] : 0;
		const entries = prefix.map((item, index) => `(${this.render(item, ancestors)})${index >= minimum ? "?" : ""}`);
		const rest = Array.isArray(items) ? schema["additionalItems"] : items;
		if (rest !== false) entries.push(`...(${this.render(rest, ancestors)})[]`);
		return `[${entries.join(", ")}]`;
	}
}

/** Check schema-backed inputs; untyped nested results stay dynamic, as in Code/Notebook. */
export function buildTsToolDeclarations(tools: readonly CodeModeToolDefinition[]): string {
	const declarations: string[] = [];
	const fields = tools.map((tool, index) => {
		const optional = "invoke" in tool && (tool.discovery === "help" || tool.inputOptional === true);
		let input = "command" in tool ? "string | Record<string, unknown> | unknown[]" : "string";
		if (!("command" in tool) && tool.kind === "function") {
			input = `__TsToolInput${index}`;
			declarations.push(new SchemaTypes(tool.inputSchema, input).declaration());
			input += " | string";
		}
		return `readonly ${JSON.stringify(codeModeGlobalName(tool.name))}: (input${optional ? "?" : ""}: ${input}) => Promise<any>`;
	});
	return [...declarations, `declare const tools: { ${fields.join("; ")} };`].join("\n");
}
