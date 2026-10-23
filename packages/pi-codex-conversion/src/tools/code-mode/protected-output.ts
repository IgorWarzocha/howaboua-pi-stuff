import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { codexToolProviderHeaders, resolveCodexToolProvider, resolveCodexApiProviderBaseUrl } from "../../adapter/codex-tool-provider.ts";

const DELIVERY_SCOPE = Symbol("Authenticated protected output scope");
const DELIVERY_AVAILABLE = "@howaboua/pi-codex-conversion/protected-output-available/v1";
interface DeliveryRequest { protocol: 1; ctx: ExtensionContext; available?: boolean }

/** An installed package does not establish an active provider rewrite. */
export function canDeliverProtectedOutput(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
	const request: DeliveryRequest = { protocol: 1, ctx };
	pi.events.emit(DELIVERY_AVAILABLE, request);
	return request.available === true;
}

export function registerProtectedOutputHost(pi: ExtensionAPI, available: (ctx: ExtensionContext) => boolean): () => void {
	return pi.events.on(DELIVERY_AVAILABLE, value => {
		const request = value as DeliveryRequest | undefined;
		if (request?.protocol === 1 && request.ctx && available(request.ctx)) request.available = true;
	});
}

/** Credentials for the active transport only, never another registered model. */
export async function resolveActiveCodexProvider(ctx: ExtensionContext) {
	if (ctx.model?.api !== "openai-codex-responses") throw new Error("Protected contents are unavailable on this model");
	const model = JSON.stringify(ctx.model);
	const provider = await resolveCodexToolProvider(ctx);
	if (model !== JSON.stringify(ctx.model)) throw new Error("Model changed during authentication; retry with the original model");
	if (provider.route !== "openai-codex") throw new Error("Protected contents are unavailable on this provider");
	return { baseUrl: provider.baseUrl, accountId: provider.accountId, headers: codexToolProviderHeaders(provider) };
}

export function protectedAccountScope(accountId: string): string {
	return createHash("sha256").update(accountId).digest("hex");
}

/** Host session binding is independent of any extension's context-window policy. */
export async function resolveProtectedOutputScope(ctx: ExtensionContext): Promise<string> {
	const before = JSON.stringify([ctx.sessionManager.getSessionId(), ctx.model]);
	const provider = await resolveActiveCodexProvider(ctx);
	if (before !== JSON.stringify([ctx.sessionManager.getSessionId(), ctx.model]))
		throw new Error("Context changed during authentication; start a new exec cell");
	return JSON.stringify({ sessionId: ctx.sessionManager.getSessionId(),
		accountScope: protectedAccountScope(provider.accountId), baseUrl: provider.baseUrl });
}

/** Host-only proof; JSON/model arguments cannot authorise protected delivery. */
export function bindProtectedOutputScope(result: object, scope: string): void {
	Object.defineProperty(result, DELIVERY_SCOPE, { value: scope });
}

export function protectedOutputScope(result: unknown): string | undefined {
	return result && typeof result === "object" && DELIVERY_SCOPE in result && typeof result[DELIVERY_SCOPE] === "string"
		? result[DELIVERY_SCOPE] : undefined;
}

/** Also reads the old family-scoped encoding without retaining its execution engine. */
export function validateRemoteScope(encoded: unknown, account: () => string | undefined, ctx?: ExtensionContext, baseUrl?: string): void {
	let scope: unknown;
	try { scope = typeof encoded === "string" ? JSON.parse(encoded) : undefined; }
	catch { throw new Error("Protected result has invalid account scope"); }
	const accountId = account();
	if (!scope || typeof scope !== "object" ||
		!("sessionId" in scope) || typeof scope.sessionId !== "string" || !scope.sessionId ||
		!("baseUrl" in scope) || typeof scope.baseUrl !== "string" || !scope.baseUrl ||
		!("accountScope" in scope) || !accountId || scope.accountScope !== protectedAccountScope(accountId))
		throw new Error("Protected contents belong to a different account");
	if (baseUrl && scope.baseUrl !== resolveCodexApiProviderBaseUrl(baseUrl))
		throw new Error("Protected contents belong to a different backend");
	const hostSession = "threadId" in scope ? scope.threadId : scope.sessionId;
	if (typeof hostSession !== "string" || !hostSession) throw new Error("Protected result has invalid session scope");
	if (ctx && hostSession !== ctx.sessionManager.getSessionId())
		throw new Error("Protected contents belong to a different session");
}

export function validateRemoteOutputReplay(messages: readonly unknown[], account: () => string | undefined, ctx?: ExtensionContext, baseUrl?: string): void {
	for (const message of messages) {
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "toolResult" || !("details" in message)) continue;
		const details = message.details;
		if (details && typeof details === "object" && "codeMode" in details && details.codeMode === true &&
			"opaqueOutputs" in details && Array.isArray(details.opaqueOutputs) && details.opaqueOutputs.length)
			validateRemoteScope("opaqueScope" in details ? details.opaqueScope : undefined, account, ctx, baseUrl);
	}
}
