import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { resolveCodexToolProvider } from "../adapter/codex-tool-provider.ts";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { contextAccountScope, contextAgentIdentity } from "./agent-identity.ts";

const PARAMETERS = Type.Object({
	query: Type.Optional(Type.String({ encrypted: true })),
	text: Type.Optional(Type.String({ encrypted: true })),
}, { additionalProperties: false, minProperties: 1 });
const MAX_HANDLES = 128;
const MAX_BYTES = 8 * 1024 * 1024;
const TTL_MS = 15 * 60_000;
type Field = "query" | "text";

/** Ciphertext stays in this registration's host memory. Handles are never persisted. */
export function registerRemoteContextInput(pi: ExtensionAPI, state: AdapterState) {
	const handles = new Map<string, { field: Field; value: string; scope: string; expires: number; bytes: number }>();
	let generation = 0;
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	const clear = () => {
		generation++; handles.clear();
		if (expiryTimer) clearTimeout(expiryTimer);
		expiryTimer = undefined;
	};
	pi.on("session_start", clear);
	pi.on("model_select", clear);
	pi.on("session_shutdown", clear);
	pi.on("session_tree", clear);
	const prune = () => {
		for (const [handle, entry] of handles) if (entry.expires <= Date.now()) handles.delete(handle);
	};
	const armExpiry = () => {
		if (expiryTimer) clearTimeout(expiryTimer);
		const expires = Math.min(...[...handles.values()].map(entry => entry.expires));
		if (!Number.isFinite(expires)) { expiryTimer = undefined; return; }
		expiryTimer = setTimeout(() => { expiryTimer = undefined; prune(); armExpiry(); }, Math.max(1, expires - Date.now()));
		expiryTimer.unref();
	};
	const scope = async (ctx: ExtensionContext) => {
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		if (!plan.contextManagementNested || !plan.contextManagementRemote)
			throw new Error("context_input requires Remote context in Code or Notebook");
		const epoch = generation;
		const identity = contextAgentIdentity(ctx);
		const provider = await resolveCodexToolProvider(ctx);
		const latest = resolveCodexRuntimePlanForState(ctx, state);
		if (epoch !== generation || identity.threadId !== ctx.sessionManager.getSessionId() ||
			!latest.contextManagementNested || !latest.contextManagementRemote || latest.kind !== plan.kind ||
			JSON.stringify(identity) !== JSON.stringify(contextAgentIdentity(ctx)))
			throw new Error("Context changed; call context_input again");
		const account = contextAccountScope(provider.accountId);
		if (provider.route !== "openai-codex" || (identity.accountScope && identity.accountScope !== account))
			throw new Error("Remote context requires the same Codex account");
		return JSON.stringify([identity.threadId, identity.sessionId, identity.agentName, account,
			ctx.model?.provider, ctx.model?.id, provider.baseUrl, plan.kind]);
	};
	pi.registerTool({
		name: "context_input",
		exposure: "model-only",
		label: "context_input",
		description: "Prepare query or note text for tools.history/tools.notes in exec; pass returned handles unchanged",
		parameters: PARAMETERS,
		renderCall(args, theme) {
			const fields = (["query", "text"] as const).filter(field => args[field] !== undefined);
			return new Text(`${theme.fg("toolTitle", "context_input")} ${theme.fg("muted", fields.map(field => `${field}: protected`).join(", "))}`, 0, 0);
		},
		async execute(_id, params, signal, _update, ctx) {
			const owner = await scope(ctx);
			signal?.throwIfAborted();
			prune();
			const fields = (["query", "text"] as const).filter(field => params[field] !== undefined);
			if (!fields.length) throw new Error("context_input requires query or text");
			const bytes = fields.reduce((sum, field) => sum + Buffer.byteLength(params[field]!, "utf8"), 0);
			const held = [...handles.values()].reduce((sum, entry) => sum + entry.bytes, 0);
			if (handles.size + fields.length > MAX_HANDLES || held + bytes > MAX_BYTES)
				throw new Error("Context input capacity reached; reuse live handles or wait 15 minutes before acquiring more");
			const result: Partial<Record<Field, string>> = {};
			for (const field of fields) {
				const value = params[field]!;
				const handle = crypto.randomUUID();
				handles.set(handle, { field, value, scope: owner, expires: Date.now() + TTL_MS, bytes: Buffer.byteLength(value, "utf8") });
				result[field] = handle;
			}
			armExpiry();
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
		},
	});
	return async (input: unknown, ctx: ExtensionContext): Promise<unknown> => {
		if (!input || typeof input !== "object" || Array.isArray(input)) return input;
		const params = { ...input } as Record<string, unknown>;
		const field: Field | undefined = params["action"] === "search_contents" ? "query"
			: params["action"] === "write_file" || params["action"] === "append_to_file" ? "text" : undefined;
		if (!field) return input;
		const owner = await scope(ctx);
		prune();
		const handle = params[field];
		const entry = typeof handle === "string" ? handles.get(handle) : undefined;
		if (!entry || entry.field !== field || entry.scope !== owner)
			throw new Error(`Call native context_input with ${field}, then pass its returned ${field} handle unchanged`);
		params[field] = entry.value;
		return params;
	};
}
