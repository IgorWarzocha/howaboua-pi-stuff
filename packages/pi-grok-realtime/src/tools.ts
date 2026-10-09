import {
	type Static,
	type TSchema,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export type GrokToolResult =
	| null
	| boolean
	| number
	| string
	| GrokToolResult[]
	| { [key: string]: GrokToolResult };

export interface GrokToolContext {
	signal: AbortSignal;
	ctx: ExtensionContext;
	callId: string;
}

export interface GrokToolDefinition<T extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: T;
	execute(
		args: Static<T>,
		context: GrokToolContext,
	): GrokToolResult | Promise<GrokToolResult>;
}

export interface GrokToolWireDefinition extends Record<string, unknown> {
	type: "function";
	name: string;
	description: string;
	parameters: TSchema;
}

export interface GrokToolRegistry {
	definitions: GrokToolWireDefinition[];
	execute(
		name: string,
		args: unknown,
		context: GrokToolContext,
	): Promise<GrokToolResult>;
}

interface Registration {
	definition: GrokToolWireDefinition;
	execute(args: unknown, context: GrokToolContext): Promise<GrokToolResult>;
}

const COLLECT_TOOLS = "grok-realtime:collect-tools";
const RESERVED = new Set(["send_task", "end_the_call", "work_landed"]);

/** Register during extension loading. Pi removes this subscription on reload. */
export function registerGrokTool<T extends TSchema>(
	pi: ExtensionAPI,
	tool: GrokToolDefinition<T>,
): () => void {
	if (!tool.name || RESERVED.has(tool.name)) {
		throw new Error(`Voice tool name is empty or reserved: ${tool.name}`);
	}
	const definition: GrokToolWireDefinition = {
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
	const execute = tool.execute;
	const registration: Registration = {
		definition,
		async execute(args, context) {
			context.signal.throwIfAborted();
			const validated: Static<T> = validateToolArguments(definition, {
				type: "toolCall",
				id: context.callId,
				name: definition.name,
				arguments: args as { [key: string]: GrokToolResult },
			});
			const result = await withAbort(
				() => execute(validated, context),
				context.signal,
			);
			if (!isJson(result, new Set())) {
				throw new Error(
					`Voice tool ${definition.name} returned a non-JSON result`,
				);
			}
			return result;
		},
	};
	return pi.events.on(COLLECT_TOOLS, (collect) => {
		(collect as (registration: Registration) => void)(registration);
	});
}

/** Snapshot once when a call starts. Later registrations affect the next call. */
export function collectGrokTools(pi: ExtensionAPI): GrokToolRegistry {
	const registrations = new Map<string, Registration>();
	let duplicate: string | undefined;
	pi.events.emit(COLLECT_TOOLS, (registration: Registration) => {
		const name = registration.definition.name;
		if (registrations.has(name) || RESERVED.has(name)) duplicate = name;
		else registrations.set(name, registration);
	});
	// EventBus catches listener errors, so report conflicts outside the listener.
	if (duplicate)
		throw new Error(`Duplicate or reserved voice tool: ${duplicate}`);
	return {
		definitions: [...registrations.values()].map(
			({ definition }) => definition,
		),
		async execute(name, args, context) {
			const registration = registrations.get(name);
			if (!registration) throw new Error(`Unknown voice tool: ${name}`);
			return registration.execute(args, context);
		},
	};
}

async function withAbort<T>(
	run: () => T | Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	signal.throwIfAborted();
	let abort = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([
			Promise.resolve().then(() => {
				signal.throwIfAborted();
				return run();
			}),
			cancelled,
		]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

function isJson(value: unknown, ancestors: Set<object>): boolean {
	if (value === null) return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value !== "object" || ancestors.has(value)) return false;
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	)
		return false;
	if (Object.getOwnPropertySymbols(value).length) return false;
	ancestors.add(value);
	const valid = Array.isArray(value)
		? Array.from(value).every((entry) => isJson(entry, ancestors))
		: Object.values(value).every((entry) => isJson(entry, ancestors));
	ancestors.delete(value);
	return valid;
}
