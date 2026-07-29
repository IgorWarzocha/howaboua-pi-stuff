import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getPackageDir, RpcClient } from "@earendil-works/pi-coding-agent";
import { CHILD_ENV, REVIEW_LABEL, REVIEW_PROMPT_PATH } from "./constants.js";
import { createChildRunDetails } from "./run-details.js";
import type { ChildRunDetails, ResolvedReviewConfig } from "./types.js";

const REVIEW_TIMEOUT_MS = 30 * 60 * 1_000;

function recordAssistantMessage(
	details: ChildRunDetails,
	message: AssistantMessage,
): void {
	details.messages.push(message);
	details.usage.turns++;
	details.usage.input += message.usage.input || 0;
	details.usage.output += message.usage.output || 0;
	details.usage.cacheRead += message.usage.cacheRead || 0;
	details.usage.cacheWrite += message.usage.cacheWrite || 0;
	details.usage.cost += message.usage.cost.total || 0;
	details.usage.contextTokens = message.usage.totalTokens || 0;
	details.stopReason = message.stopReason;
	if (message.errorMessage) details.errorMessage = message.errorMessage;
}

export async function runReviewSubagent(
	task: string,
	cwd: string,
	config: ResolvedReviewConfig,
	signal?: AbortSignal,
) {
	const details = createChildRunDetails(task, cwd, config);
	const client = new RpcClient({
		cliPath: join(getPackageDir(), "dist", "cli.js"),
		cwd,
		env: { [CHILD_ENV]: "1" },
		model: config.model,
		args: [
			"--no-session",
			"--no-skills",
			"--thinking",
			config.thinking,
			"--append-system-prompt",
			REVIEW_PROMPT_PATH,
		],
	});
	const prompt = [
		"Run as the Review Subagent inside an isolated no-session RPC subprocess.",
		"Stay strictly in review mode. Do not edit files or propose implementation plans beyond concise fixes.",
		"Do not stop after one or two findings; keep looking for additional credible issues, aiming for roughly 10-20 if warranted.",
		"Mode: review",
		`Task: ${task}`,
	].join("\n\n");
	const abort = () => {
		void client.abort().catch(() => undefined);
	};

	try {
		if (signal?.aborted) throw new Error(`${REVIEW_LABEL} aborted.`);
		await client.start();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) throw new Error(`${REVIEW_LABEL} aborted.`);
		await client.setAutoCompaction(true);
		await client.setAutoRetry(true);
		if (signal?.aborted) throw new Error(`${REVIEW_LABEL} aborted.`);
		const events = await client.promptAndWait(
			prompt,
			undefined,
			REVIEW_TIMEOUT_MS,
		);
		for (const event of events) {
			if (event.type === "message_end" && event.message.role === "assistant") {
				recordAssistantMessage(details, event.message);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		await client.stop();
	}

	details.stderr = client.getStderr();
	details.exitCode = 0;
	return details;
}
