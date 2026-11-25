import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { NotesLifecycle } from "./lifecycle.js";
import {
	HISTORY_USAGE,
	NOTES_NESTED_SCHEMA,
	NOTES_USAGE,
} from "./tool-contracts.js";
import type { createTools } from "./tools.js";
import { projectTreeCheckpointBranch } from "./tree-checkpoint.js";
import { projectTreeHandoffBranch } from "./tree-handoff-read.js";
import type { WindowCheckpoints } from "./window-checkpoint.js";

export async function registerNotesToolIntegrations(
	pi: ExtensionAPI,
	lifecycle: NotesLifecycle,
	registration: ReturnType<typeof createTools>,
) {
	const { tools, requestContext } = registration;
	let refreshNested = () => {};
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const rollover: ReturnType<typeof adaptToolForCodeMode> = {
			name: "new_context",
			topLevelName: "new_context",
			usage: "tools.new_context(args)",
			description: "",
			kind: "function",
			inputOptional: true,
			deferLoading: true,
			discoverWhenDeferred: false,
			propagateTermination: true,
			executionMode: "sequential",
			inputSchema: tools.find((tool) => tool.name === "new_context")!
				.parameters,
			async invoke(input, context, signal) {
				if (
					!context.extensionContext ||
					!context.originalExecCallId ||
					!context.toolCallId
				)
					throw new Error(
						"Rollover unavailable in this call. Save notes, then call new_context directly.",
					);
				const output = await requestContext(
					context.toolCallId,
					input,
					signal,
					context.extensionContext,
					context.originalExecCallId,
				);
				context.captureResult?.(output);
				const part = output.content[0];
				return part?.type === "text" ? JSON.parse(part.text) : undefined;
			},
		};
		const registration = registerCodeModeExtensionTools(
			pi,
			() => {
				rollover.inputSchema = tools.find(
					(tool) => tool.name === "new_context",
				)!.parameters;
				return [
					rollover,
					...tools
						.filter((tool) => tool.name === "notes" || tool.name === "history")
						.map((tool) => ({
							...adaptToolForCodeMode(tool, {
								discovery: "help",
								usage: tool.name === "notes" ? NOTES_USAGE : HISTORY_USAGE,
								opaqueResult: tool.name === "notes",
								...(tool.name === "history"
									? { resultValue: historyResultValue }
									: {}),
							}),
							// Nested callers type-check before Pi prepares the input.
							...(tool.name === "notes"
								? { inputSchema: NOTES_NESTED_SCHEMA }
								: {}),
						})),
				];
			},
			{ isActive: () => lifecycle.active },
		);
		refreshNested = registration.refresh;
		pi.on("session_shutdown", () => registration.unregister());
		const { withCodexDeveloperMessageDetails } =
			await import("@howaboua/pi-codex-conversion/developer-messages");
		lifecycle.prepareReminder = withCodexDeveloperMessageDetails;
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
	}
	return refreshNested;
}

function historyResultValue(result: AgentToolResult<unknown>): unknown {
	const [part] = result.content;
	if (result.content.length === 1 && part?.type === "text") {
		try {
			return JSON.parse(part.text);
		} catch {
			return part.text;
		}
	}
	return { content: result.content };
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
		const stopProjection = registerContextBranchProjection(pi, (entries, ctx) =>
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
