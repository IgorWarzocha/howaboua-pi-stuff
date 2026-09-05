import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isCanonicalCodexSubscriptionModel } from "../adapter/prompt/codex-model.ts";
import { isTerminalRateLimitError } from "../providers/openai-codex/errors.ts";
import { fetchCodexReserveStatus } from "./client.ts";
import { CODEX_RESERVE_MODEL } from "./reserve-policy.ts";

const RETURN_ENTRY = "codex-reserve-return";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
interface ReserveReturn {
	accountKey: string;
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
}

function readReturn(ctx: ExtensionContext): ReserveReturn | undefined {
	const entry = ctx.sessionManager.getBranch().findLast((item) => item.type === "custom" && item.customType === RETURN_ENTRY);
	if (entry?.type !== "custom") return undefined;
	const value: unknown = entry.data;
	if (!value || typeof value !== "object") return undefined;
	if (!("accountKey" in value) || typeof value.accountKey !== "string"
		|| !("provider" in value) || typeof value.provider !== "string"
		|| !("modelId" in value) || typeof value.modelId !== "string"
		|| !("thinkingLevel" in value)) return undefined;
	const thinkingLevel = value.thinkingLevel;
	if (thinkingLevel !== "off" && thinkingLevel !== "minimal" && thinkingLevel !== "low"
		&& thinkingLevel !== "medium" && thinkingLevel !== "high" && thinkingLevel !== "xhigh" && thinkingLevel !== "max") return undefined;
	return { accountKey: value.accountKey, provider: value.provider, modelId: value.modelId, thinkingLevel };
}

export function createCodexReserveController(pi: ExtensionAPI) {
	let switching = false;
	return {
		modelSelected(ctx: ExtensionContext) {
			if (!switching && ctx.model?.id !== CODEX_RESERVE_MODEL && readReturn(ctx)) pi.appendEntry(RETURN_ENTRY, null);
		},
		async beforeTurn(ctx: ExtensionContext): Promise<void> {
			if (ctx.model?.id !== CODEX_RESERVE_MODEL || !isCanonicalCodexSubscriptionModel(ctx.model)) return;
			const previous = readReturn(ctx);
			if (!previous) return;
			const model = ctx.model;
			const leaf = ctx.sessionManager.getLeafId();
			try {
				const status = await fetchCodexReserveStatus(ctx);
				if (ctx.model !== model || ctx.sessionManager.getLeafId() !== leaf) return;
				if (!status || status.accountKey !== previous.accountKey) {
					ctx.ui.notify("Cannot verify the original Luna Reserve account; automatic model return is paused. Use /model to choose another model.", "warning");
					return;
				}
				if (!status.ordinaryUsageRecovered) return;
				const target = ctx.modelRegistry.find(previous.provider, previous.modelId);
				if (!target) {
					ctx.ui.notify("Ordinary Codex usage is available again, but the original model is unavailable. Select a model with /model.", "warning");
					return;
				}
				switching = true;
				if (!await pi.setModel(target)) throw new Error("Original model authentication is unavailable");
				pi.setThinkingLevel(previous.thinkingLevel);
				pi.appendEntry(RETURN_ENTRY, null);
				ctx.ui.notify(`Ordinary Codex usage recovered. Restored ${target.name} and its reasoning level.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not complete ordinary Codex model recovery: ${error instanceof Error ? error.message : String(error)}. Use /model to check or switch manually.`, "warning");
			} finally {
				switching = false;
			}
		},
		async settled(ctx: ExtensionContext): Promise<boolean> {
			const model = ctx.model;
			if (!model || !isCanonicalCodexSubscriptionModel(model)) return false;
			const branch = ctx.sessionManager.getBranch();
			const last = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (last?.type !== "message" || last.message.role !== "assistant" || last.message.stopReason !== "error") return false;
			if (last.message.model !== model.id || last.message.provider !== model.provider) return false;
			const errorText = last.message.errorMessage ?? "";
			if (!isTerminalRateLimitError(errorText) && !/Codex usage limit reached|hit your ChatGPT usage limit/i.test(errorText)) return false;
			if (model.id === CODEX_RESERVE_MODEL) return true;
			const leaf = ctx.sessionManager.getLeafId();
			try {
				const status = await fetchCodexReserveStatus(ctx);
				if (ctx.model !== model || ctx.sessionManager.getLeafId() !== leaf || !status?.entryAllowed) return true;
				const reserve = ctx.modelRegistry.find(model.provider, CODEX_RESERVE_MODEL);
				if (!reserve || !isCanonicalCodexSubscriptionModel(reserve)) {
					ctx.ui.notify("Codex quota exhausted; Luna Reserve is offered but unavailable in this provider’s model catalog.", "warning");
					return true;
				}
				const previous: ReserveReturn = { accountKey: status.accountKey, provider: model.provider, modelId: model.id, thinkingLevel: pi.getThinkingLevel() };
				pi.appendEntry(RETURN_ENTRY, previous);
				switching = true;
				if (!await pi.setModel(reserve)) throw new Error("Luna Reserve authentication is unavailable");
				pi.setThinkingLevel(previous.thinkingLevel);
				ctx.ui.notify("Codex quota exhausted. Switched to Luna Reserve (separate, limited allowance). Send ‘continue’ if you want to use Luna, or choose another model with /model. Nothing was retried.", "warning");
			} catch (error) {
				ctx.ui.notify(`Codex quota exhausted; Luna Reserve fallback could not complete: ${error instanceof Error ? error.message : String(error)}. Check the current model with /model.`, "warning");
			} finally {
				switching = false;
			}
			return true;
		},
	};
}
