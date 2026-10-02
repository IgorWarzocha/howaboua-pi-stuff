import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexToolProvider, resolveCodexApiProviderBaseUrl } from "../adapter/codex-tool-provider.ts";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { contextAccountScope, contextAgentIdentity, type ContextAgentIdentity } from "./agent-identity.ts";

const BACKEND_SCOPE = Symbol("Remote context backend scope");
const EXPECTED_SCOPE = Symbol("Remote context expected scope");

export function remoteContextScope(identity: ContextAgentIdentity, accountId: string, baseUrl: string): string {
	return JSON.stringify({ threadId: identity.threadId, sessionId: identity.sessionId,
		agentName: identity.agentName, accountScope: contextAccountScope(accountId), baseUrl });
}

export function withRemoteContextScope(ctx: ExtensionContext, scope: string | undefined): ExtensionContext {
	if (!scope) throw new Error("Remote context authentication is unavailable");
	const scoped: ExtensionContext = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx));
	Object.defineProperty(scoped, EXPECTED_SCOPE, { value: scope });
	return scoped;
}

/** Only the trusted host nested route carries this symbol, never model arguments. */
export function isRemoteNestedContext(ctx: ExtensionContext): boolean {
	return EXPECTED_SCOPE in ctx;
}

export function assertRemoteBackendScope(ctx: ExtensionContext, scope: string): void {
	if (EXPECTED_SCOPE in ctx && ctx[EXPECTED_SCOPE] !== scope)
		throw new Error("Remote context changed before dispatch; start a new exec cell");
}

export async function resolveRemoteContextScope(ctx: ExtensionContext, state: AdapterState): Promise<string> {
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (!plan.contextManagementNested || !plan.contextManagementRemote)
		throw new Error("Remote context requires Code or Notebook");
	const identity = contextAgentIdentity(ctx);
	const model = JSON.stringify([ctx.model?.api, ctx.model?.provider, ctx.model?.id, ctx.model?.baseUrl]);
	const provider = await resolveCodexToolProvider(ctx);
	const latest = resolveCodexRuntimePlanForState(ctx, state);
	if (!latest.contextManagementNested || !latest.contextManagementRemote || latest.kind !== plan.kind ||
		JSON.stringify(identity) !== JSON.stringify(contextAgentIdentity(ctx)) ||
		model !== JSON.stringify([ctx.model?.api, ctx.model?.provider, ctx.model?.id, ctx.model?.baseUrl]))
		throw new Error("Remote context changed during authentication; start a new exec cell");
	if (provider.route !== "openai-codex" ||
		(identity.accountScope && identity.accountScope !== contextAccountScope(provider.accountId)))
		throw new Error("Remote context requires the same Codex account");
	return remoteContextScope(identity, provider.accountId, provider.baseUrl);
}

/** Host-only provenance, never part of Normal's JSON details or backend payload. */
export function bindRemoteBackendScope(result: object, scope: string): void {
	Object.defineProperty(result, BACKEND_SCOPE, { value: scope });
}

export function remoteBackendScope(result: unknown): string | undefined {
	if (!result || typeof result !== "object" || !(BACKEND_SCOPE in result)) return undefined;
	return typeof result[BACKEND_SCOPE] === "string" ? result[BACKEND_SCOPE] : undefined;
}

export function validateRemoteOutputReplay(messages: readonly unknown[], account: () => string | undefined, ctx?: ExtensionContext, baseUrl?: string): void {
	for (const message of messages) {
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "toolResult" ||
			!("details" in message)) continue;
		const details = message.details;
		if (!details || typeof details !== "object" || !("codeMode" in details) || details.codeMode !== true ||
			!("opaqueOutputs" in details) || !Array.isArray(details.opaqueOutputs) || !details.opaqueOutputs.length) continue;
		const encoded = "opaqueScope" in details ? details.opaqueScope : undefined;
		validateRemoteScope(encoded, account, ctx, baseUrl);
	}
}

export function validateRemoteScope(encoded: unknown, account: () => string | undefined, ctx?: ExtensionContext, baseUrl?: string): void {
	const accountId = account();
	let scope: unknown;
	try { scope = typeof encoded === "string" ? JSON.parse(encoded) : undefined; }
	catch { throw new Error("Remote result has invalid account scope"); }
	if (!scope || typeof scope !== "object" ||
		!("threadId" in scope) || typeof scope.threadId !== "string" || !scope.threadId ||
		!("sessionId" in scope) || typeof scope.sessionId !== "string" || !scope.sessionId ||
		!("agentName" in scope) || typeof scope.agentName !== "string" || !/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(scope.agentName) ||
		!("baseUrl" in scope) || typeof scope.baseUrl !== "string" || !scope.baseUrl ||
		!("accountScope" in scope) || typeof scope.accountScope !== "string" || !/^[a-f0-9]{64}$/.test(scope.accountScope) ||
		!accountId || scope.accountScope !== contextAccountScope(accountId))
		throw new Error("Remote result belongs to a different Codex account; use its original account");
	if (baseUrl && scope.baseUrl !== resolveCodexApiProviderBaseUrl(baseUrl))
		throw new Error("Remote result belongs to a different backend; use its original backend");
	if (ctx) {
		const identity = contextAgentIdentity(ctx);
		if (scope.threadId !== identity.threadId || scope.sessionId !== identity.sessionId || scope.agentName !== identity.agentName)
			throw new Error("Remote result belongs to a different context family");
	}
}
