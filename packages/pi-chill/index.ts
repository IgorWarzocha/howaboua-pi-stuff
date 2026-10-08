import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import {
	ActivityTimeline,
	activityEntryTypes,
	activityMessageTypes,
	hasCodeModeError,
} from "./src/activity.js";
import {
	activityEntryRenderer,
	activityMessageRenderer,
} from "./src/activity-messages.js";
import { ActivityRenderers } from "./src/renderers.js";

export default function (pi: ExtensionAPI) {
	const timeline = new ActivityTimeline();
	let enabled = true;
	const renderers = new ActivityRenderers(timeline, () => enabled);
	let tui = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let redraw: ((invalidate?: boolean) => void) | undefined;
	let outcome: "completed" | "interrupted" = "completed";
	let promptDepth = 0;

	const stopTimer = () => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	};
	const captureRedraw = (ctx: ExtensionContext) => {
		// The public factory exposes TUI rendering. Remove the empty widget before any frame.
		const key = "@howaboua/pi-chill/redraw";
		try {
			ctx.ui.setWidget(key, (tui) => {
				redraw = (invalidate = false) => {
					if (invalidate) tui.invalidate();
					tui.requestRender();
				};
				return new Container();
			});
		} finally {
			ctx.ui.setWidget(key, undefined);
		}
	};
	const restore = (ctx: ExtensionContext) => {
		stopTimer();
		redraw = undefined;
		tui = ctx.mode === "tui";
		if (tui) {
			captureRedraw(ctx);
			ctx.ui.setHiddenThinkingLabel(enabled ? "" : undefined);
		}
		promptDepth = 0;
		renderers.clear();
		timeline.restore(ctx.sessionManager.buildContextEntries());
	};
	const progress = () => {
		const group = timeline.current;
		if (!group) return;
		group.refresh();
	};

	pi.registerMarkdownTransformer((markdown, context) => {
		if (!tui || !enabled) return markdown;
		if (context.messageType === "assistant-thinking") return "";
		if (
			context.messageType === "user" &&
			["Continue.", "Continue, unless awaiting for user approval."].includes(
				markdown.trim(),
			)
		)
			return "";
		return markdown;
	});
	// Pass-through tools also bypass execution tracking and restore membership.
	// Exempting only their renderer would leave invisible calls inside the group.
	pi.registerToolRenderer((name, next) =>
		tui && name !== "new_context" ? renderers.resolve(name, next()) : next(),
	);
	const messageRenderer = activityMessageRenderer(timeline, () => enabled);
	for (const type of activityMessageTypes)
		pi.registerMessageRenderer(type, (message, options, theme) =>
			tui ? messageRenderer(message, options, theme) : undefined,
		);
	const entryRenderer = activityEntryRenderer(timeline, () => enabled);
	for (const type of activityEntryTypes)
		pi.registerEntryRenderer(type, (entry, options, theme) =>
			tui ? entryRenderer(entry, options, theme) : undefined,
		);
	pi.registerCommand("chill", {
		description: "Toggle folded activity for this session",
		handler: async (_args, ctx) => {
			if (_args.trim()) {
				ctx.ui.notify("Use /chill without arguments", "warning");
				return;
			}
			enabled = !enabled;
			if (tui) {
				ctx.ui.setHiddenThinkingLabel(enabled ? "" : undefined);
				// Markdown caches before transformation; toggles need full invalidation.
				redraw?.(true);
			}
			timeline.refresh();
		},
	});
	pi.on("session_start", (_event, ctx) => {
		enabled = true;
		restore(ctx);
	});
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_before_compact", (_event, ctx) => {
		timeline.reconcileMessages(ctx.sessionManager.buildContextEntries());
	});
	pi.on("session_compact", (_event, ctx) => {
		const ids = new Set<string>();
		const entries = ctx.sessionManager.buildContextEntries();
		for (const entry of entries) {
			if (entry.type !== "message" || entry.message.role !== "assistant")
				continue;
			for (const block of entry.message.content) {
				if (block.type === "toolCall") ids.add(block.id);
			}
		}
		// The first member may have been compacted away. Re-anchor without losing live timing.
		timeline.retain(ids, entries);
		renderers.prune();
	});
	pi.on("agent_start", () => {
		if (!tui) return;
		timeline.beginRun();
		outcome = "completed";
		stopTimer();
		progress();
		timer = setInterval(() => {
			progress();
			// Custom notice invalidation alone does not request a native frame.
			redraw?.();
		}, 1000);
	});
	pi.on("message_start", (event) => {
		const message = event.message;
		if (tui && message.role === "user") timeline.userStarted();
		if (
			tui &&
			message.role === "custom" &&
			message.display &&
			activityMessageTypes.some((type) => type === message.customType)
		) {
			timeline.addMessage(message, true);
			progress();
		}
		if (!tui || !timeline.current || event.message.role !== "assistant") return;
		timeline.assistantStarted();
		timeline.assistantUpdated(event.message.content);
		timeline.current.stage.thinking("");
		progress();
	});
	pi.on("message_update", (event) => {
		if (!tui || !timeline.current) return;
		const update = event.assistantMessageEvent;
		if (event.message.role === "assistant")
			timeline.assistantUpdated(event.message.content);
		if (
			update.type === "thinking_start" ||
			update.type === "thinking_delta" ||
			update.type === "thinking_end"
		) {
			const block = update.partial.content[update.contentIndex];
			timeline.current.stage.thinking(
				update.type === "thinking_end"
					? update.content
					: block?.type === "thinking"
						? block.thinking
						: "",
			);
		} else return;
		progress();
	});
	pi.on("tool_execution_start", (event) => {
		if (!tui || event.toolName === "new_context") return;
		timeline.current?.stage.start(
			event.toolCallId,
			event.toolName,
			event.args,
			event.parentToolCallId,
		);
		progress();
		if (event.parentToolCallId) return;
		const { group, call } = timeline.add(event.toolCallId, event.toolName);
		call.status = "running";
		group.refresh();
	});
	pi.on("tool_execution_update", (event) => {
		if (!tui || event.toolName === "new_context") return;
		timeline.current?.stage.update(event.toolCallId, event.partialResult);
		progress();
	});
	pi.on("tool_execution_end", (event) => {
		if (!tui || event.toolName === "new_context") return;
		timeline.current?.stage.end(event.toolCallId, event.result, event.isError);
		progress();
		if (event.parentToolCallId) return;
		const { group, call } = timeline.add(event.toolCallId, event.toolName);
		call.status =
			event.isError || hasCodeModeError(event.result?.details)
				? "error"
				: "done";
		group.refresh();
	});
	pi.on("ui_prompt_start", () => {
		promptDepth++;
		if (timeline.current) {
			timeline.current.attention = true;
			timeline.current.refresh();
		}
		if (tui) progress();
	});
	pi.on("ui_prompt_end", () => {
		promptDepth = Math.max(0, promptDepth - 1);
		if (timeline.current) {
			timeline.current.attention = promptDepth > 0;
			timeline.current.refresh();
		}
		if (tui) progress();
	});
	// Low-level agent_end can precede compaction or queued continuation. Record
	// its outcome here, but keep the timer/group alive until the SDK settles.
	pi.on("agent_end", (event) => {
		const last = event.messages.findLast(
			(message) => message.role === "assistant",
		);
		if (
			last?.role === "assistant" &&
			(last.stopReason === "aborted" ||
				last.stopReason === "error" ||
				last.stopReason === "length")
		) {
			outcome = "interrupted";
		}
	});
	pi.on("agent_settled", (event, ctx) => {
		stopTimer();
		timeline.reconcileMessages(ctx.sessionManager.buildContextEntries());
		timeline.finish(Date.now(), event.aborted ? "interrupted" : outcome);
	});
	pi.on("session_shutdown", () => {
		stopTimer();
		redraw = undefined;
	});
}
