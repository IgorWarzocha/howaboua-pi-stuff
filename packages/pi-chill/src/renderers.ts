import { keyHint, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	MouseRegion,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { ActivityGroup, ActivityTimeline } from "./activity.js";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderContext = Parameters<CallRenderer>[2];
type RenderTheme = Parameters<CallRenderer>[1];

function renderResultFallback(
	result: Parameters<NonNullable<ToolRenderers["renderResult"]>>[0],
	expanded: boolean,
	theme: RenderTheme,
): Component {
	const output = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	if (!output) return new Container();
	// Pi's generic fallback is private. Match its logical-line preview boundary
	// with public Text and keyHint, leaving width wrapping to Text as native does.
	const lines = output.split("\n");
	const visible = expanded ? lines : lines.slice(0, 10);
	const remaining = lines.length - visible.length;
	let text = visible.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return new Text(text, 0, 0);
}

export function renderActivityHeading(
	group: ActivityGroup,
	theme: RenderTheme,
	outputPad = 1,
): Component {
	const container = new Container();
	container.addChild(
		new MouseRegion(
			new Text(
				theme.fg(
					group.warning ? "warning" : "muted",
					`${group.open ? "▾" : "▸"} ${group.label()}`,
				),
				outputPad,
				0,
			),
			(event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				group.open = !group.open;
				group.refresh();
				return { handled: true };
			},
		),
	);
	// Fit at render time: the terminal can resize without a new activity event.
	container.addChild({
		invalidate() {},
		render: (width) => {
			const indent = " ".repeat(outputPad + 3);
			const format = (label: string) =>
				theme.fg(
					label.startsWith("Failed ") || label.startsWith("Needs attention ")
						? "warning"
						: "muted",
					label,
				);
			const detail =
				group.endedAt === undefined
					? group.stage.label(Math.max(0, width - indent.length), format)
					: group.stage.summary(Math.max(0, width - indent.length), format);
			return detail
				? [truncateToWidth(theme.fg("muted", `${indent}${detail}`), width)]
				: [];
		},
	});
	return container;
}

interface CallView {
	detailsOpen: boolean | undefined;
	nativeExpanded: boolean;
	nativeState: RenderContext["state"] | undefined;
	state: Record<string, unknown>;
	callComponent: Component | undefined;
	resultComponent: Component | undefined;
	offShell: Box | undefined;
}

export class ActivityRenderers {
	private readonly views = new Map<string, CallView>();
	readonly timeline: ActivityTimeline;
	private readonly isEnabled: () => boolean;
	constructor(
		timeline: ActivityTimeline,
		isEnabled: () => boolean = () => true,
	) {
		this.timeline = timeline;
		this.isEnabled = isEnabled;
	}

	clear(): void {
		this.views.clear();
	}

	prune(): void {
		for (const id of this.views.keys()) {
			if (!this.timeline.calls.has(id)) this.views.delete(id);
		}
	}

	private view(id: string): CallView {
		let view = this.views.get(id);
		if (!view) {
			view = {
				detailsOpen: undefined,
				nativeExpanded: false,
				nativeState: undefined,
				state: {},
				callComponent: undefined,
				resultComponent: undefined,
				offShell: undefined,
			};
			this.views.set(id, view);
		}
		return view;
	}

	resolve(name: string, original: ToolRenderers | undefined): ToolRenderers {
		const rawVisible = (context: RenderContext) => {
			const member = this.timeline.calls.get(context.toolCallId);
			return (
				(!this.isEnabled() || member?.group.open) &&
				(this.view(context.toolCallId).detailsOpen ?? context.expanded)
			);
		};
		const box = (
			theme: RenderTheme,
			context: RenderContext,
			paddingY: number,
		) => {
			const color =
				context.isError ||
				(this.isEnabled() &&
					this.timeline.calls.get(context.toolCallId)?.call.status === "error")
					? "toolErrorBg"
					: context.isPartial
						? "toolPendingBg"
						: "toolSuccessBg";
			return new Box(context.outputPad, paddingY, (line) =>
				theme.bg(color, line),
			);
		};
		const frame = (
			child: Component,
			theme: RenderTheme,
			context: RenderContext,
		): Component => {
			if (original?.renderShell === "self") return child;
			const shell = box(theme, context, 0);
			shell.addChild(child);
			return shell;
		};
		const toggleDetails = (child: Component, context: RenderContext) =>
			new MouseRegion(child, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				const view = this.view(context.toolCallId);
				view.detailsOpen = !rawVisible(context);
				if (view.detailsOpen) {
					const group = this.timeline.calls.get(context.toolCallId)?.group;
					if (this.isEnabled() && group && !group.open) {
						group.open = true;
						group.refresh();
					}
				}
				context.invalidate();
				return { handled: true };
			});
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const { group, call } = this.timeline.add(context.toolCallId, name);
				const member = group.members.get(call.id);
				if (member) member.invalidate = context.invalidate;
				const view = this.view(call.id);
				// Native Ctrl+O supersedes an individual click choice. Keep that choice
				// only until the native expansion state actually changes.
				if (view.nativeState !== context.state) {
					view.nativeState = context.state;
					view.nativeExpanded = context.expanded;
				} else if (view.nativeExpanded !== context.expanded) {
					view.nativeExpanded = context.expanded;
					view.detailsOpen = undefined;
					group.nativeExpansion(context.expanded, call.id);
				}
				const container = new Container();
				view.offShell = undefined;
				if (this.isEnabled() && group.anchorId === call.id) {
					container.addChild(
						renderActivityHeading(group, theme, context.outputPad),
					);
				}
				if (!this.isEnabled() || rawVisible(context)) {
					// The wrapped renderer owns its own mutable state and cached components.
					// Passing Chill's container back as lastComponent would corrupt reuse.
					const rawContext = {
						...context,
						expanded: view.detailsOpen ?? context.expanded,
						state: view.state,
						lastComponent: view.callComponent,
					};
					const child =
						original?.renderCall?.(args, theme, rawContext) ??
						new Text(`${name}\n${JSON.stringify(args, null, 2)}`, 0, 0);
					view.callComponent = child;
					if (!this.isEnabled() && original?.renderShell !== "self") {
						view.offShell = box(theme, context, 1);
						view.offShell.addChild(toggleDetails(child, context));
						return view.offShell;
					}
					container.addChild(
						toggleDetails(frame(child, theme, context), context),
					);
				} else if (group.open) {
					const status = context.isError ? "error" : call.status;
					container.addChild(
						toggleDetails(
							new Text(
								theme.fg(
									status === "error" || status === "interrupted"
										? "warning"
										: "muted",
									`  ▸ ${name} · ${status}`,
								),
								context.outputPad,
								0,
							),
							context,
						),
					);
				}
				return container;
			},
			renderResult: (result, options, theme, context) => {
				if (this.isEnabled() && !rawVisible(context)) return new Container();
				const view = this.view(context.toolCallId);
				const rawContext = {
					...context,
					expanded: view.detailsOpen ?? context.expanded,
					state: view.state,
					lastComponent: view.resultComponent,
				};
				const child =
					original?.renderResult?.(
						result,
						{ ...options, expanded: rawContext.expanded },
						theme,
						rawContext,
					) ?? renderResultFallback(result, rawContext.expanded, theme);
				view.resultComponent = child;
				if (!this.isEnabled() && view.offShell) {
					view.offShell.addChild(toggleDetails(child, context));
					return new Container();
				}
				return toggleDetails(frame(child, theme, context), context);
			},
		};
	}
}
