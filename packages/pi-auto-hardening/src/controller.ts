import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RESULT_MESSAGE_TYPE } from "./constants.js";
import {
	findRepoRoot,
	fingerprintRepository,
	inspectHardeningContext,
} from "./git.js";
import { parseWorkerDisposition } from "./protocol.js";
import { getFinalOutput, runHardeningWorker } from "./subagent.js";
import { buildHardeningTask } from "./task.js";
import type { WorkerRunDetails } from "./types.js";

function formatWorkerResult(details: WorkerRunDetails): string {
	const finalOutput = getFinalOutput(details.messages).trim();
	const disposition = parseWorkerDisposition(finalOutput);
	const sections = ["# Automatic hardening pass"];
	if (disposition.status === "complete") {
		sections.push("Status: complete", "Existing checks passed before handoff.");
	} else if (disposition.status === "blocked") {
		sections.push("Status: blocked", `Blocker: ${disposition.reason}`);
	} else {
		sections.push(
			"Status: incomplete",
			"The worker stopped without a clean completion marker.",
		);
	}
	if (finalOutput)
		sections.push("Worker summary:", finalOutput.slice(0, 8_000));
	return sections.join("\n\n");
}

export function registerControllerMode(pi: ExtensionAPI): void {
	let startFingerprint: string | undefined;
	let running = false;
	let workerAbort: AbortController | undefined;

	pi.on("agent_start", async (_event, ctx) => {
		if (startFingerprint || running) return;
		const repoRoot = await findRepoRoot(pi, ctx.cwd);
		if (!repoRoot) return;
		startFingerprint = await fingerprintRepository(pi, repoRoot);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (running) return;
		const baseline = startFingerprint;
		startFingerprint = undefined;
		if (!baseline) return;

		let context;
		try {
			context = await inspectHardeningContext(pi, ctx.cwd);
		} catch (error) {
			ctx.ui.notify(
				`Automatic hardening scan failed: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
			return;
		}
		if (!context || context.fingerprint === baseline) return;
		if (!ctx.model) {
			ctx.ui.notify(
				"Automatic hardening skipped: no active model is available for the worker.",
				"warning",
			);
			return;
		}

		running = true;
		workerAbort = new AbortController();
		ctx.ui.setStatus("auto-hardening", "hardening branch diff…");
		ctx.ui.notify(
			`Automatic hardening: inspecting ${context.currentBranch} against ${context.base.label}.`,
			"info",
		);
		try {
			const details = await runHardeningWorker({
				task: buildHardeningTask(context),
				cwd: context.repoRoot,
				model: `${ctx.model.provider}/${ctx.model.id}`,
				thinking: pi.getThinkingLevel(),
				projectTrusted: ctx.isProjectTrusted(),
				signal: workerAbort.signal,
			});
			const result = formatWorkerResult(details);
			const disposition = parseWorkerDisposition(
				getFinalOutput(details.messages),
			);
			pi.sendMessage(
				{
					customType: RESULT_MESSAGE_TYPE,
					content: result,
					display: true,
					details: { disposition },
				},
				{ deliverAs: "nextTurn" },
			);
			ctx.ui.notify(
				disposition.status === "complete"
					? "Automatic hardening pass complete."
					: "Automatic hardening worker stopped with remaining work or a blocker.",
				disposition.status === "complete" ? "info" : "warning",
			);
		} catch (error) {
			if (!workerAbort.signal.aborted) {
				ctx.ui.notify(
					`Automatic hardening failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		} finally {
			ctx.ui.setStatus("auto-hardening", undefined);
			workerAbort = undefined;
			running = false;
		}
	});

	pi.on("session_shutdown", () => {
		workerAbort?.abort();
	});
}
