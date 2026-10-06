import type { FetchFunction } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodeModeToolPreflightRegistration } from "@howaboua/pi-codex-conversion/code-mode-preflight";
import { ParentBindings } from "./src/parents.js";
import {
	type Assessment,
	isRecord,
	ReviewFailure,
	reviewAction,
	serializeAction,
} from "./src/review.js";
import { loadScope, requiresReview, type ScopePolicy } from "./src/scope.js";

const SETTING_ENTRY = "codex-guardian-setting";
const PARENT_REQUIRED =
	"Guardian blocked this action: no current ChatGPT Codex parent is available. Ask the user to select a signed-in Codex model, then request the action again.";
const CONTEXT_REQUIRED =
	"Guardian blocked this action: its context cannot be reviewed intact. Ask the user to start a shorter text-only session with complete authorization.";
const REVIEW_FAILED =
	"Guardian could not complete this review. Nothing executed. Retry the action, or ask the user to check /guardian status.";

export default async function guardian(
	pi: ExtensionAPI,
	networkFetch: FetchFunction = globalThis.fetch,
): Promise<void> {
	let enabled = true;
	let revision = 0;
	let last: Assessment | undefined;
	let lastFailure: string | undefined;
	let scope: ScopePolicy = { valid: false, error: "Review policy not loaded" };
	let preflight: CodeModeToolPreflightRegistration | undefined;
	const parents = new ParentBindings();
	const reviews = new Set<AbortController>();

	const invalidate = () => {
		revision++;
		parents.clear();
		for (const review of reviews) review.abort();
	};
	const updateStatus = (ctx: ExtensionContext) => {
		ctx.ui.setStatus("guardian", enabled ? "Guardian on" : "Guardian off");
	};
	const restore = (ctx: ExtensionContext) => {
		invalidate();
		enabled = true;
		last = undefined;
		lastFailure = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (
				entry.type === "custom" &&
				entry.customType === SETTING_ENTRY &&
				isRecord(entry.data) &&
				typeof entry.data["enabled"] === "boolean"
			)
				enabled = entry.data["enabled"];
		}
		updateStatus(ctx);
	};
	parents.register(pi, () => enabled);
	const reloadScope = (ctx: ExtensionContext) => {
		invalidate();
		scope = loadScope(ctx.cwd, ctx.isProjectTrusted());
		if (!scope.valid) ctx.ui.notify(scope.error, "error");
	};
	pi.on("session_start", (_event, ctx) => {
		reloadScope(ctx);
		restore(ctx);
	});
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_before_switch", invalidate);
	pi.on("session_before_fork", invalidate);
	pi.on("session_before_tree", invalidate);
	pi.on("session_before_compact", invalidate);
	pi.on("session_compact", invalidate);
	pi.on("model_select", invalidate);
	pi.on("before_agent_start", invalidate);
	pi.on("message_start", (event) => {
		if (
			event.message.role === "user" ||
			event.message.role === "system" ||
			event.message.role === "custom"
		)
			invalidate();
	});
	pi.on("session_shutdown", () => {
		invalidate();
		preflight?.dispose();
	});

	pi.registerCommand("guardian", {
		description: "Guardian status, on, off, reload review policy",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "on" || action === "off") {
				invalidate();
				enabled = action === "on";
				last = undefined;
				lastFailure = undefined;
				pi.appendEntry(SETTING_ENTRY, { enabled });
				updateStatus(ctx);
			} else if (action === "reload") {
				reloadScope(ctx);
			} else if (action !== "status") {
				ctx.ui.notify("Usage: /guardian status|on|off|reload", "warning");
				return;
			}
			const nested = preflight?.available
				? "Native Pi + Code/Notebook"
				: "Native Pi. Code/Notebook preflight unavailable";
			const usage = last
				? ` Last review: ${last.outcome}, ${last.inputTokens} input tokens, ${last.outputTokens} output tokens. Token counts are not billing.`
				: " No review completed.";
			const failure = lastFailure ? ` Last failure: ${lastFailure}.` : "";
			const policy = scope.valid
				? ` Review policy (${scope.source}): ${Object.entries(scope.review)
						.map(([name, enabled]) => `${name}=${enabled}`)
						.join(
							", ",
						)}.${ctx.isProjectTrusted() ? "" : " Repo config ignored: folder not trusted."}`
				: ` Configuration error: ${scope.error}. Actions blocked while Guardian is on.`;
			ctx.ui.notify(
				`Guardian ${enabled ? "on" : "off"}. ${nested}.${policy}${usage}${failure}`,
				"info",
			);
		},
	});

	type Action = {
		toolName: string;
		input: unknown;
		toolCallId: string;
		cwd: string;
	};
	const admit = async (
		action: Action,
		originCallId: string | undefined,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<{ block: true; reason: string } | undefined> => {
		if (!enabled) return;
		if (
			!scope.valid ||
			scope.cwd !== ctx.cwd ||
			(scope.source === "repo" && !ctx.isProjectTrusted())
		)
			return {
				block: true,
				reason:
					"Guardian configuration is unavailable or no longer trusted. Ask the user to check /guardian status and reload its review policy.",
			};
		const parent = parents.resolve(originCallId, ctx);
		if (!requiresReview(action.toolName, scope.review)) {
			if (parent) parents.admitted(action.toolCallId, parent);
			return;
		}
		if (!parent) {
			lastFailure = parents.contextUnavailable
				? "Context unavailable"
				: "No current ChatGPT Codex parent";
			return {
				block: true,
				reason: parents.contextUnavailable ? CONTEXT_REQUIRED : PARENT_REQUIRED,
			};
		}
		const controller = new AbortController();
		const signals = [controller.signal, signal, ctx.signal].filter(
			(item): item is AbortSignal => item !== undefined,
		);
		const cancellation = AbortSignal.any(signals);
		const observedRevision = revision;
		const observedLeaf = ctx.sessionManager.getLeafId();
		const observedSystem = ctx.getSystemPrompt();
		reviews.add(controller);
		try {
			const exactAction = serializeAction(action);
			const assessment = await reviewAction({
				ctx,
				fetch: networkFetch,
				model: parent.model,
				parentThreadId: parent.sessionId,
				parentResponseId: parent.responseId,
				context: JSON.parse(parent.context),
				action: JSON.parse(exactAction),
				signal: cancellation,
			});
			if (
				cancellation.aborted ||
				(scope.valid && scope.source === "repo" && !ctx.isProjectTrusted()) ||
				observedRevision !== revision ||
				observedLeaf !== ctx.sessionManager.getLeafId() ||
				observedSystem !== ctx.getSystemPrompt() ||
				parents.resolve(originCallId, ctx) !== parent ||
				exactAction !== serializeAction(action)
			) {
				if (observedRevision === revision) lastFailure = "Stale review";
				return {
					block: true,
					reason:
						"Guardian review became stale. Nothing executed. Request the action again.",
				};
			}
			last = assessment;
			lastFailure = undefined;
			updateStatus(ctx);
			if (assessment.outcome !== "allow")
				return {
					block: true,
					reason:
						"Guardian denied this action. Nothing executed. Ask the user to clarify its authorization before retrying.",
				};
			parents.admitted(action.toolCallId, parent);
			return;
		} catch (error) {
			if (observedRevision === revision) {
				lastFailure =
					error instanceof ReviewFailure
						? error.httpStatus
							? `Reviewer unavailable (HTTP ${error.httpStatus})`
							: {
									context: "Context unavailable",
									unavailable: "Reviewer unavailable",
									cancelled: "Review cancelled",
									timeout: "Review timed out",
									malformed: "Malformed assessment",
								}[error.kind]
						: "Reviewer unavailable";
			}
			return {
				block: true,
				reason:
					error instanceof ReviewFailure && error.kind === "context"
						? CONTEXT_REQUIRED
						: REVIEW_FAILED,
			};
		} finally {
			reviews.delete(controller);
			controller.abort();
		}
	};

	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) return;
		if (
			["exec", "wait", "notebook"].includes(event.toolName) &&
			!preflight?.available
		)
			return {
				block: true,
				reason:
					"Guardian blocked this action: Code/Notebook preflight is unavailable. Ask the user to install or update Pi Codex Conversion, then retry.",
			};
		return admit(
			{
				toolName: event.toolName,
				input: event.input,
				toolCallId: event.toolCallId,
				cwd: ctx.cwd,
			},
			event.parentToolCallId ?? event.toolCallId,
			ctx,
		);
	});
	try {
		const { registerCodeModeToolPreflight } = await import(
			"@howaboua/pi-codex-conversion/code-mode-preflight"
		);
		preflight = registerCodeModeToolPreflight(pi, (call) =>
			admit(
				{
					toolName: call.toolName,
					input: call.input,
					toolCallId: call.toolCallId,
					cwd: call.cwd,
				},
				call.originalExecCallId,
				call.extensionContext,
				call.signal,
			),
		);
	} catch {
		// Native Pi still works. Wrappers fail closed, with visible recovery above.
	}
}
