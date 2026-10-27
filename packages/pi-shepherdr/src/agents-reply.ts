import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { AgentsParams } from "./agents-contract.js";
import {
	dispatchAgentWork,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import type { ConnectedMachine } from "./fleet/index.js";
import type { PaneInfo } from "./types.js";

export async function replyAgent(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	params: AgentsParams,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
) {
	const reply = {
		extension: params.extension!,
		id: params.id!,
		message: params.message!,
	};
	const view = await runtime.monitor.view(panel);
	const pending = view.extensionMessages?.find(
		(message) =>
			message.extension === reply.extension && message.id === reply.id,
	);
	signal.throwIfAborted();
	let result: string | undefined;
	const send = async () => {
		result = await runtime.client.replyExtension(panel, reply);
	};
	if (!pending?.blocking) {
		await send();
		return toolResult({
			machine: runtime.machine,
			target: panel.pane_id,
			extension: reply.extension,
			id: reply.id,
			result,
		});
	}
	const { settlement, warning } = await dispatchAgentWork(
		runtime,
		panel,
		`Reply to ${reply.extension}`,
		true,
		signal,
		onUpdate,
		send,
		{ replyingTo: reply },
	);
	return toolResult(
		{
			...(settlement
				? settlementResult(runtime.machine, settlement, {
						reportWorkerError: true,
					})
				: {}),
			machine: runtime.machine,
			target: panel.pane_id,
			extension: reply.extension,
			id: reply.id,
			result,
		},
		warning,
	);
}
