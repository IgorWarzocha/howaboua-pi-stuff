import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { NotesLifecycle } from "./lifecycle.js";
import {
	GPT_NEW_CONTEXT_DESCRIPTION,
	GPT_NOTES_DESCRIPTION,
	HISTORY_USAGE,
	NEW_CONTEXT_DESCRIPTION,
	NOTES_DESCRIPTION,
	NOTES_USAGE,
} from "./tool-contracts.js";
import type { createTools } from "./tools.js";
import { projectTreeCheckpointBranch } from "./tree-checkpoint.js";
import { projectTreeHandoffBranch } from "./tree-handoff-read.js";
import type { WindowCheckpoints } from "./window-checkpoint.js";

export async function registerNotesToolIntegrations(
	pi: ExtensionAPI,
	lifecycle: NotesLifecycle,
	tools: ReturnType<typeof createTools>,
) {
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		const registration = registerGptPromptMode(pi, (active) => {
			for (const [name, normal, gpt] of [
				["notes", NOTES_DESCRIPTION, GPT_NOTES_DESCRIPTION],
				["new_context", NEW_CONTEXT_DESCRIPTION, GPT_NEW_CONTEXT_DESCRIPTION],
			] as const) {
				const tool = tools.find((tool) => tool.name === name);
				const description = active ? gpt : normal;
				if (tool && tool.description !== description) {
					tool.description = description;
					pi.registerTool(tool);
				}
			}
			return lifecycle.active ? tools : [];
		});
		lifecycle.gptPromptMode = () => registration.active;
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
	let refreshNested = () => {};
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() =>
				tools
					.filter((tool) => tool.name === "notes" || tool.name === "history")
					.map((tool) =>
						adaptToolForCodeMode(tool, {
							discovery: "help",
							usage: tool.name === "notes" ? NOTES_USAGE : HISTORY_USAGE,
							deferLoading: true,
							opaqueResult: tool.name === "notes",
							resultValue(result) {
								const [part] = result.content;
								if (result.content.length === 1 && part?.type === "text") {
									try {
										return JSON.parse(part.text);
									} catch {
										return part.text;
									}
								}
								return { content: result.content };
							},
						}),
					),
			{ isActive: () => lifecycle.active },
		);
		refreshNested = registration.refresh;
		pi.on("session_shutdown", () => registration.unregister());
		const { withCodexDeveloperMessageDetails } = await import(
			"@howaboua/pi-codex-conversion/developer-messages"
		);
		lifecycle.prepareReminder = withCodexDeveloperMessageDetails;
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
	}
	return refreshNested;
}

export async function registerNotesCompactionIntegration(
	pi: ExtensionAPI,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
	checkpoints: WindowCheckpoints,
) {
	let prepareProviderWindow:
		| ((ctx: ExtensionContext) => Promise<void>)
		| undefined;
	const prepareCompaction = (
		event: import("@earendil-works/pi-coding-agent").SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	) =>
		activation.available
			? (checkpoints.prepare(event, ctx) ?? lifecycle.beforeCompact(event, ctx))
			: undefined;
	try {
		const {
			registerCompactionPreparation,
			registerContextBranchProjection,
			prepareContextWindow,
		} = await import("@howaboua/pi-codex-conversion/compaction");
		prepareProviderWindow = (ctx) => prepareContextWindow(pi, ctx);
		const registration = registerCompactionPreparation(pi, prepareCompaction);
		const stopProjection = registerContextBranchProjection(
			pi,
			(entries, ctx) =>
				activation.available
					? projectTreeHandoffBranch(
							lifecycle.windows.projectBranch(
								projectTreeCheckpointBranch(
									entries,
									ctx.sessionManager.getEntries(),
								),
							),
						)
					: entries,
		);
		pi.on("session_shutdown", stopProjection);
		pi.on("session_before_compact", registration.prepare);
		pi.on("session_shutdown", () => registration.dispose());
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
		pi.on("session_before_compact", prepareCompaction);
	}

	return prepareProviderWindow;
}

export function optionalPccMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		[
			"ERR_MODULE_NOT_FOUND",
			"MODULE_NOT_FOUND",
			"ERR_PACKAGE_PATH_NOT_EXPORTED",
		].includes(String(error.code)) &&
		error.message.includes("@howaboua/pi-codex-conversion")
	);
}
