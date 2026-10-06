import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	MouseRegion,
	Text,
} from "@earendil-works/pi-tui";
import type { ActivityTimeline } from "./activity.js";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderContext = Parameters<CallRenderer>[2];
type RenderTheme = Parameters<CallRenderer>[1];

interface CallView {
	detailsOpen: boolean;
	state: Record<string, unknown>;
	callComponent: Component | undefined;
	resultComponent: Component | undefined;
}

export class ActivityRenderers {
	private readonly views = new Map<string, CallView>();
	readonly timeline: ActivityTimeline;
	constructor(timeline: ActivityTimeline) {
		this.timeline = timeline;
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
				detailsOpen: false,
				state: {},
				callComponent: undefined,
				resultComponent: undefined,
			};
			this.views.set(id, view);
		}
		return view;
	}

	resolve(name: string, original: ToolRenderers | undefined): ToolRenderers {
		const rawVisible = (context: RenderContext) => {
			const member = this.timeline.calls.get(context.toolCallId);
			return (
				context.isError ||
				member?.call.status === "error" ||
				member?.call.status === "interrupted" ||
				(member?.group.open &&
					(context.expanded || this.view(context.toolCallId).detailsOpen))
			);
		};
		const frame = (
			child: Component,
			theme: RenderTheme,
			context: RenderContext,
		): Component => {
			if (original?.renderShell === "self") return child;
			const color =
				context.isError ||
				this.timeline.calls.get(context.toolCallId)?.call.status === "error"
					? "toolErrorBg"
					: context.isPartial
						? "toolPendingBg"
						: "toolSuccessBg";
			const box = new Box(1, 0, (line) => theme.bg(color, line));
			box.addChild(child);
			return box;
		};
		const toggleDetails = (child: Component, context: RenderContext) =>
			new MouseRegion(child, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				const view = this.view(context.toolCallId);
				view.detailsOpen = !view.detailsOpen;
				context.invalidate();
				return { handled: true };
			});
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const { group, call } = this.timeline.add(context.toolCallId, name);
				call.invalidate = context.invalidate;
				if (group.nativeExpanded !== context.expanded) {
					group.nativeExpanded = context.expanded;
					group.open = context.expanded;
				}
				const container = new Container();
				if (group.calls[0]?.id === call.id) {
					const heading = new Text(
						theme.fg(
							group.attention ? "warning" : "muted",
							`${group.open ? "▾" : "▸"} ${group.label()}`,
						),
						1,
						0,
					);
					container.addChild(
						new MouseRegion(heading, (event) => {
							if (event.type !== "click" || event.button !== "left")
								return undefined;
							group.open = !group.open;
							group.refresh();
							return { handled: true };
						}),
					);
				}
				if (rawVisible(context)) {
					const view = this.view(call.id);
					const rawContext = {
						...context,
						expanded: true,
						state: view.state,
						lastComponent: view.callComponent,
					};
					const child =
						original?.renderCall?.(args, theme, rawContext) ??
						new Text(`${name}\n${JSON.stringify(args, null, 2)}`, 0, 0);
					view.callComponent = child;
					container.addChild(
						toggleDetails(frame(child, theme, context), context),
					);
				} else if (group.open) {
					container.addChild(
						toggleDetails(
							new Text(theme.fg("muted", `  ▸ ${name} · ${call.status}`), 1, 0),
							context,
						),
					);
				}
				return container;
			},
			renderResult: (result, options, theme, context) => {
				if (!rawVisible(context)) return new Container();
				const view = this.view(context.toolCallId);
				const rawContext = {
					...context,
					expanded: true,
					state: view.state,
					lastComponent: view.resultComponent,
				};
				const child =
					original?.renderResult?.(
						result,
						{ ...options, expanded: true },
						theme,
						rawContext,
					) ??
					new Text(
						result.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n"),
						0,
						0,
					);
				view.resultComponent = child;
				return toggleDetails(frame(child, theme, context), context);
			},
		};
	}
}
