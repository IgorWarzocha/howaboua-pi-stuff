import { normalizeContext, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RealtimeVoiceTurn } from "./turns.ts";

const SYSTEM_PROMPT =
	"Rewrite this conversation as a natural, self-contained request to another assistant. Preserve the user's intent, relevant context and uncertainty without inventing facts or decisions. Don't carry out the request. Return only the request.";

/** Tool-free sidecar: no Pi history, startup summary, or session mutation. */
export async function rewriteTaskDelegation(
	ctx: ExtensionContext,
	voice: {
		taskDelegationModel: string;
		taskDelegationReasoning:
			| "off"
			| "minimal"
			| "low"
			| "medium"
			| "high"
			| "xhigh"
			| "max";
	},
	turn: RealtimeVoiceTurn,
	signal: AbortSignal,
): Promise<string> {
	if (turn.preparationError) throw new Error(turn.preparationError);
	let failure: unknown;
	for (let attempt = 0; attempt < 4; attempt++) {
		signal.throwIfAborted();
		try {
			const separator = voice.taskDelegationModel.indexOf("/");
			const model =
				separator > 0
					? ctx.modelRegistry.find(
							voice.taskDelegationModel.slice(0, separator),
							voice.taskDelegationModel.slice(separator + 1),
						)
					: undefined;
			if (!model)
				throw new Error(
					`Task delegation model is unavailable: ${voice.taskDelegationModel}`,
				);
			const provider = ctx.modelRegistry.getProvider(model.provider);
			if (!provider)
				throw new Error(
					`Task delegation provider is unavailable: ${model.provider}`,
				);
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(auth.error);
			signal.throwIfAborted();
			const requestModel = auth.baseUrl
				? { ...model, baseUrl: auth.baseUrl }
				: model;
			let result = "";
			let completed = false;
			for await (const event of provider.streamSimple(
				requestModel,
				normalizeContext({
					systemPrompt: SYSTEM_PROMPT,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `${turn.transcriptDelta ? `${turn.transcriptDelta}\n` : ""}user: ${turn.input}`,
								},
							],
							timestamp: Date.now(),
						},
					],
				}),
				{
					...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
					...(auth.headers ? { headers: auth.headers } : {}),
					...(auth.env ? { env: auth.env } : {}),
					signal,
					maxTokens: requestModel.maxTokens,
					cacheRetention: "none",
					sessionId: uuidv7(),
					...(requestModel.reasoning && voice.taskDelegationReasoning !== "off"
						? { reasoning: voice.taskDelegationReasoning }
						: {}),
				},
			)) {
				if (event.type === "error")
					throw new Error(
						event.error.errorMessage || "Task delegation model failed",
					);
				if (event.type === "done") {
					if (event.reason !== "stop")
						throw new Error(
							`Task delegation model did not finish (${event.reason})`,
						);
					completed = true;
					result = event.message.content
						.flatMap((part) => (part.type === "text" ? [part.text] : []))
						.join("\n")
						.trim();
				}
			}
			signal.throwIfAborted();
			if (!completed || !result)
				throw new Error("Task delegation model returned no instruction");
			return result;
		} catch (error) {
			signal.throwIfAborted();
			failure = error;
			// Repeating an overfull interval cannot make it fit; never clip it.
			if (
				error instanceof Error &&
				/context.{0,40}(length|limit|window|exceed)|too many tokens|maximum context/i.test(
					error.message,
				)
			)
				break;
		}
	}
	throw new Error(
		`Could not prepare the voice request; nothing was sent to Pi. ${failure instanceof Error ? failure.message : String(failure)}`,
	);
}
