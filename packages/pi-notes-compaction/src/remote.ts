import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	bindProtectedOutputScope,
	canDeliverProtectedOutput,
	protectedAccountScope,
	resolveActiveCodexProvider,
	resolveProtectedOutputScope,
} from "@howaboua/pi-codex-conversion/code-mode";
import {
	type ContextAgentIdentity,
	contextAgentIdentity,
	contextTargetAgent,
} from "./agent-identity.js";
import type { CachedResponse, LookupQuery } from "./bridge.js";
import type {
	RemoteNoteReference,
	SharedContextRequest,
	SharedContextResult,
} from "./context-sharing.js";

const ENDPOINTS = {
	list_files_by_prefix: [
		"file_order",
		"file_order_by",
		"max_results",
		"prefix",
	],
	read_file: ["path", "start_line", "stop_line"],
	search_contents: [
		"max_files",
		"max_matches_per_file",
		"path_prefix",
		"query",
		"recent_file_first",
	],
} as const;

function readQuery(query: LookupQuery): {
	action: string;
	args: Record<string, unknown>;
} {
	if (query.namespace !== "notes")
		throw new Error(
			"History is available only from saved Pi JSONL sessions. Restore access to the session on this machine, then retry.",
		);
	const action = query.params["action"];
	const actions: Record<string, readonly string[]> = ENDPOINTS;
	if (typeof action !== "string" || !Object.hasOwn(actions, action))
		throw new Error("Remote lookup requires a supported read action");
	const fields = actions[action]!;
	for (const [field, value] of Object.entries(query.params)) {
		if (field === "action") continue;
		if (!fields.includes(field))
			throw new Error(`${query.namespace} ${action} does not accept ${field}`);
		if (value === undefined || value === null) continue;
		if (
			[
				"max_results",
				"max_files",
				"max_matches_per_file",
				"start_line",
				"stop_line",
			].includes(field)
		) {
			if (
				typeof value !== "number" ||
				!Number.isSafeInteger(value) ||
				(!["start_line", "stop_line"].includes(field) && value < 1)
			)
				throw new Error(`Invalid ${field}`);
		} else if (field === "recent_file_first") {
			if (typeof value !== "boolean") throw new Error(`Invalid ${field}`);
		} else if (typeof value !== "string") throw new Error(`Invalid ${field}`);
	}
	const required =
		action === "read_file"
			? ["path"]
			: action === "search_contents"
				? ["query"]
				: [];
	for (const field of required)
		if (typeof query.params[field] !== "string" || !query.params[field])
			throw new Error(`${query.namespace} ${action} requires ${field}`);
	const { action: _action, ...args } = query.params;
	return { action, args };
}

function scope(
	identity: ContextAgentIdentity,
	accountId: string,
	baseUrl: string,
): string {
	return JSON.stringify({
		threadId: identity.threadId,
		sessionId: identity.sessionId,
		agentName: identity.agentName,
		accountScope: protectedAccountScope(accountId),
		baseUrl,
	});
}

async function authenticated(ctx: ExtensionContext) {
	const identity = contextAgentIdentity(ctx);
	const before = JSON.stringify([identity, ctx.model]);
	const provider = await resolveActiveCodexProvider(ctx);
	const unchanged = () =>
		before === JSON.stringify([contextAgentIdentity(ctx), ctx.model]);
	if (!unchanged())
		throw new Error(
			"Context changed during authentication; retry in the original session",
		);
	if (
		identity.accountScope &&
		identity.accountScope !== protectedAccountScope(provider.accountId)
	)
		throw new Error("Remote contents belong to a different account");
	if (identity.backendUrl && identity.backendUrl !== provider.baseUrl)
		throw new Error("Remote contents belong to a different backend");
	return {
		identity,
		provider,
		unchanged,
		source: scope(identity, provider.accountId, provider.baseUrl),
	};
}

/** Automatic hybrid reads only. Writes and encrypted argument dispatch are deliberately absent. */
export function createNotesRemoteService(pi: ExtensionAPI) {
	return {
		canProject: (ctx: ExtensionContext) =>
			ctx.model?.api === "openai-codex-responses" &&
			canDeliverProtectedOutput(pi, ctx),
		lookup: lookupRemoteNotes,
		projectResult: projectNotesResponses,
	};
}

async function lookupRemoteNotes(
	query: LookupQuery,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<readonly CachedResponse[]> {
	return lookup(query, ctx, signal);
}

async function lookup(
	query: LookupQuery,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	target?: RemoteNoteReference,
): Promise<readonly CachedResponse[]> {
	const { action, args } = readQuery(query);
	const auth = await authenticated(ctx);
	if (target) checkReference(target, auth.provider);
	const headers = auth.provider.headers;
	headers.set(
		"x-openai-tool-output-truncation-policy",
		JSON.stringify({ mode: "tokens", limit: 10_000 }),
	);
	const response = await fetch(
		`${auth.provider.baseUrl.replace(/\/+$/, "")}/alpha/notes/v2/${action}`,
		{
			method: "POST",
			headers,
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(35_000)])
				: AbortSignal.timeout(35_000),
			body: JSON.stringify({
				...args,
				context: {
					session_id: target?.identity.sessionId ?? auth.identity.sessionId,
					current_agent_name:
						target?.identity.agentName ?? auth.identity.agentName,
				},
			}),
		},
	);
	if (!response.ok)
		throw new Error(`Remote lookup failed (${response.status})`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	const envelope: unknown = JSON.parse(new TextDecoder().decode(bytes));
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
		throw new Error("Remote lookup returned invalid data");
	if (!auth.unchanged())
		throw new Error(
			"Context changed during lookup; retry in the original session",
		);
	return [
		{
			query,
			bytes,
			encoding: response.headers.get("content-type") ?? "application/json",
			source: target
				? scope(target.identity, auth.provider.accountId, auth.provider.baseUrl)
				: auth.source,
			fetchedAt: Date.now(),
			coverage: "unknown",
		},
	];
}

function checkReference(
	reference: RemoteNoteReference,
	provider: { accountId: string; baseUrl: string },
): void {
	if (
		reference.identity.accountScope !==
		protectedAccountScope(provider.accountId)
	)
		throw new Error("Saved remote contents belong to a different account");
	if (
		reference.baseUrl !== provider.baseUrl ||
		reference.identity.backendUrl !== provider.baseUrl
	)
		throw new Error("Saved remote contents belong to a different backend");
}

export async function verifyRemoteReference(
	ctx: ExtensionContext,
	reference: RemoteNoteReference,
): Promise<void> {
	checkReference(reference, (await authenticated(ctx)).provider);
}

/** Saved references authorise reads against their original owner, never writes. */
export async function executeRemoteAttachment(
	ctx: ExtensionContext,
	reference: RemoteNoteReference,
	request: SharedContextRequest,
	signal?: AbortSignal,
): Promise<SharedContextResult> {
	if (request.namespace === "history")
		throw new Error(
			"History is unavailable from a saved remote notes attachment. Open its saved Pi JSONL session on this machine, then retry.",
		);
	if (
		request.sessionId !== reference.identity.sessionId ||
		(request.agentName !== reference.identity.agentName &&
			!request.agentName.startsWith(`${reference.identity.agentName}/`)) ||
		contextTargetAgent(
			request.namespace,
			request.params,
			reference.identity.agentName,
		) !== request.agentName
	)
		throw new Error(
			"Saved remote request does not belong to its checkpoint owner",
		);
	if (request.encryptedArguments)
		throw new Error("Saved remote reads require ordinary query arguments");
	const responses = await lookup(
		{ namespace: request.namespace, params: request.params },
		ctx,
		signal,
		reference,
	);
	return {
		content: [{ type: "text", text: "Saved remote read completed" }],
		details: {
			codexHistoryNotes: {},
			externalNotesResponses: responses.map(({ bytes, ...response }) => ({
				...response,
				bytesBase64: Buffer.from(bytes).toString("base64"),
			})),
		},
	};
}

async function projectNotesResponses(
	result: AgentToolResult<unknown>,
	responses: readonly CachedResponse[],
	callId: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	relay = false,
): Promise<AgentToolResult<unknown>> {
	signal?.throwIfAborted();
	if (!callId)
		throw new Error("Protected delivery requires a current tool call");
	if (!responses.length)
		return { ...result, content: result.content.map((part) => ({ ...part })) };
	const auth = await authenticated(ctx);
	const source = responses[0]!.source;
	if (relay) {
		const provenance: unknown = JSON.parse(source);
		if (
			!provenance ||
			typeof provenance !== "object" ||
			!("accountScope" in provenance) ||
			provenance.accountScope !==
				protectedAccountScope(auth.provider.accountId) ||
			!("baseUrl" in provenance) ||
			provenance.baseUrl !== auth.provider.baseUrl ||
			!("threadId" in provenance) ||
			typeof provenance.threadId !== "string" ||
			!provenance.threadId ||
			!("sessionId" in provenance) ||
			typeof provenance.sessionId !== "string" ||
			!provenance.sessionId ||
			!("agentName" in provenance) ||
			typeof provenance.agentName !== "string" ||
			!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(provenance.agentName)
		)
			throw new Error(
				"Shared protected contents belong to a different account or backend",
			);
	} else if (source !== auth.source)
		throw new Error("Cached response belongs to a different context");
	const protectedOutputs = responses.map((response, index) => {
		if (response.source !== source)
			throw new Error("Protected responses have different owners");
		readQuery(response.query);
		const envelope: unknown = JSON.parse(
			new TextDecoder().decode(response.bytes),
		);
		if (
			!envelope ||
			typeof envelope !== "object" ||
			!("encrypted_output" in envelope) ||
			typeof envelope.encrypted_output !== "string" ||
			!envelope.encrypted_output.trim()
		)
			throw new Error("Cached response contains no protected output");
		const hint =
			"attachment_hint" in envelope &&
			typeof envelope.attachment_hint === "string"
				? envelope.attachment_hint
				: undefined;
		return {
			resultId: `${callId}:${index}`,
			name: response.query.namespace + (hint ? `; ${hint}` : ""),
			encryptedOutput: envelope.encrypted_output,
		};
	});
	const deliveryScope = await resolveProtectedOutputScope(ctx);
	if (!auth.unchanged())
		throw new Error(
			"Context changed during protected delivery; retry in the original session",
		);
	signal?.throwIfAborted();
	const details = {
		...(result.details && typeof result.details === "object"
			? result.details
			: {}),
		protectedOutputs,
	};
	bindProtectedOutputScope(details, deliveryScope);
	return {
		...result,
		content: result.content.map((part) => ({ ...part })),
		details,
	};
}
