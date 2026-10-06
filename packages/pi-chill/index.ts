import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	MouseRegion,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import registerPackageChangelog from "./changelog.js";
import { ActivityTimeline, hasCodeModeError } from "./src/activity.js";
import { ActivityRenderers } from "./src/renderers.js";

export default function (pi: ExtensionAPI) {
	registerPackageChangelog(pi);
	const timeline = new ActivityTimeline();
	const renderers = new ActivityRenderers(timeline);
	let tui = false;
	let redraw: (() => void) | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let outcome: "completed" | "interrupted" = "completed";
	let promptDepth = 0;

	const stopTimer = () => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	};
	const clearWorking = (ctx: ExtensionContext) => {
		redraw = undefined;
		ctx.ui.setWidget("pi-chill-working", undefined);
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingVisible(true);
	};
	const restore = (ctx: ExtensionContext) => {
		stopTimer();
		tui = ctx.mode === "tui";
		promptDepth = 0;
		renderers.clear();
		timeline.restore(ctx.sessionManager.buildContextEntries());
		if (tui) clearWorking(ctx);
	};
	const progress = () => {
		const group = timeline.current;
		if (!group) return;
		redraw?.();
		group.calls[0]?.invalidate?.();
	};

	pi.registerToolRenderer((name, next) =>
		tui ? renderers.resolve(name, next()) : next(),
	);
	// Only routine board notifications fold. Agent questions, failures and results keep their owner renderer.
	pi.registerMessageRenderer(
		"shepherdr-board-post",
		(message, { expanded, outputPad }, theme) => {
			if (!expanded) return new Container();
			const content =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n");
			return new Text(theme.fg("dim", content), outputPad, 0);
		},
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
		const group = timeline.start();
		outcome = "completed";
		stopTimer();
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setWidget("pi-chill-working", (ui, theme) => {
			redraw = () => ui.requestRender();
			return new MouseRegion(
				{
					invalidate() {},
					render: (width) => [
						truncateToWidth(
							theme.fg(
								group.attention ? "warning" : "muted",
								`${group.open ? "▾" : "▸"} ${group.label()}`,
							),
							width,
						),
						truncateToWidth(
							theme.fg(
								"muted",
								`   ${promptDepth ? "Needs attention" : group.stage.label()}`,
							),
							width,
						),
					],
				},
				(event) => {
					if (event.type !== "click" || event.button !== "left")
						return undefined;
					group.open = !group.open;
					group.refresh();
					redraw?.();
					return { handled: true };
				},
			);
		});
		progress();
		timer = setInterval(progress, 1000);
	});
	pi.on("message_start", (event) => {
		if (!tui || !timeline.current || event.message.role !== "assistant") return;
		timeline.current.stage.thinking("");
		progress();
	});
	pi.on("message_update", (event) => {
		if (!tui || !timeline.current) return;
		const update = event.assistantMessageEvent;
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
		} else if (
			update.type === "text_start" ||
			update.type === "text_delta" ||
			update.type === "text_end"
		) {
			timeline.current.stage.writing();
		} else return;
		progress();
	});
	pi.on("tool_execution_start", (event) => {
		if (!tui) return;
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
		if (!tui) return;
		timeline.current?.stage.update(event.toolCallId, event.partialResult);
		progress();
	});
	pi.on("tool_execution_end", (event) => {
		if (!tui) return;
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
		if (tui) clearWorking(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		stopTimer();
		if (tui) clearWorking(ctx);
	});
}
