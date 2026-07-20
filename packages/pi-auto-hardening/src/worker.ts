import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAX_WORKER_PASSES } from "./constants.js";
import {
	findRepoRoot,
	fingerprintRepository,
	inspectHardeningContext,
} from "./git.js";
import { parseWorkerDisposition } from "./protocol.js";
import { formatCandidate } from "./task.js";
import { formatValidationFeedback, runExistingChecks } from "./validation.js";

function lastAssistantText(messages: readonly unknown[]): string {
	if (!Array.isArray(messages)) return "";
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			typeof message !== "object" ||
			message === null ||
			!("role" in message) ||
			message.role !== "assistant" ||
			!("content" in message) ||
			!Array.isArray(message.content)
		)
			continue;
		const content: unknown[] = message.content;
		return content
			.filter(
				(part: unknown): part is { type: "text"; text: string } =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

export function registerWorkerMode(pi: ExtensionAPI): void {
	let pass = 0;
	let runStartFingerprint: string | undefined;
	let previousUnmarkedFingerprint: string | undefined;

	pi.on("agent_start", async (_event, ctx) => {
		pass++;
		const repoRoot = await findRepoRoot(pi, ctx.cwd);
		runStartFingerprint = repoRoot
			? await fingerprintRepository(pi, repoRoot)
			: undefined;
	});

	pi.on("agent_end", async (event, ctx) => {
		const repoRoot = await findRepoRoot(pi, ctx.cwd);
		if (!repoRoot) return;
		const currentFingerprint = await fingerprintRepository(pi, repoRoot);
		const disposition = parseWorkerDisposition(
			lastAssistantText(event.messages),
		);

		if (disposition.status === "blocked") return;
		if (disposition.status === "incomplete") {
			if (
				pass >= MAX_WORKER_PASSES ||
				previousUnmarkedFingerprint === currentFingerprint
			)
				return;
			previousUnmarkedFingerprint = currentFingerprint;
			pi.sendUserMessage(
				"Continue the hardening pass. Inspect the complete current diff for remaining structural work, make the justified refactors yourself, and end with exactly [complete] or [blocker] followed by the concrete blocker.",
				{ deliverAs: "followUp" },
			);
			return;
		}

		previousUnmarkedFingerprint = undefined;
		const context = await inspectHardeningContext(pi, repoRoot);
		const validation = await runExistingChecks(
			pi,
			repoRoot,
			context?.changedFiles ?? [],
			context?.base.mergeBase,
		);
		if (!validation.passed) {
			if (pass >= MAX_WORKER_PASSES) return;
			pi.sendUserMessage(
				[
					"Existing checks failed. Fix the failures without weakening checks or adding tests, then inspect the current diff again.",
					"",
					formatValidationFeedback(validation),
					"",
					"End with exactly [complete] or [blocker] followed by the concrete blocker.",
				].join("\n"),
				{ deliverAs: "followUp" },
			);
			return;
		}

		const checkedFingerprint = await fingerprintRepository(pi, repoRoot);
		if (runStartFingerprint === checkedFingerprint) return;
		if (pass >= MAX_WORKER_PASSES) return;
		pi.sendUserMessage(
			[
				"Existing checks pass. Reinspect the complete current diff before handoff; the last pass changed repository state.",
				...(context?.candidates.length
					? [
							"",
							"Updated programmatic candidate facts (signals only):",
							...context.candidates.map(formatCandidate),
						]
					: []),
				"",
				"Fix any remaining material structural issues yourself. Do not invent features or tests. End with exactly [complete] or [blocker] followed by the concrete blocker.",
			].join("\n"),
			{ deliverAs: "followUp" },
		);
	});
}
