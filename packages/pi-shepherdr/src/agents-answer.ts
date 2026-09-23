import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { AgentsParams } from "./agents-contract.js";
import {
	dispatchAgentWork,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import {
	type AskAnswer,
	answersMatch,
	prepareAskAnswer,
	sameAgentIdentity,
} from "./ask-answer.js";
import type { ConnectedMachine } from "./fleet.js";
import { getAgent } from "./herdr.js";
import type { PaneInfo } from "./types.js";

export async function answerAgent(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	params: AgentsParams,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
) {
	const answers = params.answers as AskAnswer[];
	const askId = params.ask_id!.trim();
	const view = await runtime.monitor.view(panel);
	const prior = view.askResults?.[askId];
	if (prior) {
		const accepted =
			prior.status === "accepted" && answersMatch(answers, prior.responses);
		return toolResult({
			answered: accepted,
			ask_id: askId,
			machine: runtime.machine,
			status:
				prior.status === "rejected"
					? "rejected"
					: accepted
						? "accepted"
						: "unknown",
			target: panel.pane_id,
		});
	}
	if (view.ask?.toolCallId !== askId) {
		return toolResult({
			answered: false,
			ask_id: askId,
			machine: runtime.machine,
			status: "unknown",
			target: panel.pane_id,
		});
	}
	const prepared = await prepareAskAnswer(
		runtime.client,
		runtime.monitor,
		panel,
		answers,
		signal,
		askId,
	);
	const task = `Answer: ${prepared.ask.prompts
		.map((prompt) => prompt.title)
		.join(", ")}`;
	const { settlement, warning } = await dispatchAgentWork(
		runtime,
		panel,
		task,
		true,
		signal,
		onUpdate,
		prepared.submit,
		{ answeringAskId: askId },
	);
	const current = await getAgent(runtime.client, panel.pane_id);
	const result = (await runtime.monitor.view(current)).askResults?.[askId];
	const accepted =
		sameAgentIdentity(panel, current) &&
		result?.status === "accepted" &&
		answersMatch(answers, result.responses);
	const {
		machine: _workerMachine,
		status: workerStatus,
		target: _workerTarget,
		...workerResult
	} = settlement
		? settlementResult(runtime.machine, settlement, {
				reportWorkerError: true,
			})
		: {};
	return toolResult(
		{
			...workerResult,
			answered: accepted,
			ask_id: askId,
			machine: runtime.machine,
			status:
				result?.status === "rejected"
					? "rejected"
					: accepted
						? "accepted"
						: "unknown",
			target: panel.pane_id,
			...(workerStatus ? { worker_status: workerStatus } : {}),
		},
		warning,
	);
}
