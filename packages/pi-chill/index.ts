import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { ActivityTimeline, hasCodeModeError } from "./src/activity.js";
import { ActivityRenderers } from "./src/renderers.js";

export default function (pi: ExtensionAPI) {
	registerPackageChangelog(pi);
	const timeline = new ActivityTimeline();
	const renderers = new ActivityRenderers(timeline);
	let tui = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let outcome: "completed" | "interrupted" = "completed";
	let promptDepth = 0;

	const stopTimer = () => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	};
	const restore = (ctx: ExtensionContext) => {
		stopTimer();
		tui = ctx.mode === "tui";
		promptDepth = 0;
		renderers.clear();
		timeline.restore(ctx.sessionManager.buildContextEntries());
		ctx.ui.setWorkingMessage();
	};
	const progress = (ctx: ExtensionContext) => {
		const group = timeline.current;
		if (!group) return;
		const seconds = Math.max(
			0,
			Math.floor((Date.now() - group.startedAt) / 1000),
		);
		ctx.ui.setWorkingMessage(
			promptDepth ? "Needs attention" : `Working · ${seconds}s`,
		);
		group.calls[0]?.invalidate?.();
	};

	pi.registerToolRenderer((name, next) =>
		tui ? renderers.resolve(name, next()) : next(),
	);
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_compact", (_event, ctx) => {
		const ids = new Set<string>();
		for (const entry of ctx.sessionManager.buildContextEntries()) {
			if (entry.type !== "message" || entry.message.role !== "assistant")
				continue;
			for (const block of entry.message.content) {
				if (block.type === "toolCall") ids.add(block.id);
			}
		}
		// The first call may have been compacted away. Re-anchor without losing live timing.
		timeline.retain(ids);
		renderers.prune();
	});
	pi.on("agent_start", (_event, ctx) => {
		if (!tui) return;
		timeline.start();
		outcome = "completed";
		stopTimer();
		progress(ctx);
		timer = setInterval(() => progress(ctx), 1000);
	});
	pi.on("tool_execution_start", (event) => {
		if (!tui || event.parentToolCallId) return;
		const { group, call } = timeline.add(event.toolCallId, event.toolName);
		call.status = "running";
		group.refresh();
	});
	pi.on("tool_execution_end", (event) => {
		if (!tui || event.parentToolCallId) return;
		const { group, call } = timeline.add(event.toolCallId, event.toolName);
		call.status =
			event.isError || hasCodeModeError(event.result?.details)
				? "error"
				: "done";
		group.refresh();
	});
	pi.on("ui_prompt_start", (_event, ctx) => {
		promptDepth++;
		if (timeline.current) {
			timeline.current.attention = true;
			timeline.current.refresh();
		}
		if (tui) progress(ctx);
	});
	pi.on("ui_prompt_end", (_event, ctx) => {
		promptDepth = Math.max(0, promptDepth - 1);
		if (timeline.current) {
			timeline.current.attention = promptDepth > 0;
			timeline.current.refresh();
		}
		if (tui) progress(ctx);
	});
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
	pi.on("agent_settled", (_event, ctx) => {
		stopTimer();
		timeline.finish(Date.now(), outcome);
		if (tui) ctx.ui.setWorkingMessage();
	});
	pi.on("session_shutdown", () => stopTimer());
}
