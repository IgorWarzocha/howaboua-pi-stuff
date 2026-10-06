import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	MouseRegion,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { ActivityTimeline } from "./activity.js";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderContext = Parameters<CallRenderer>[2];
type RenderTheme = Parameters<CallRenderer>[1];

interface CallView {
	detailsOpen: boolean | undefined;
	nativeExpanded: boolean;
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
				detailsOpen: undefined,
				nativeExpanded: false,
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
				member?.group.open &&
				(this.view(context.toolCallId).detailsOpen ?? context.expanded)
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
				view.detailsOpen = !rawVisible(context);
				if (view.detailsOpen) {
					const group = this.timeline.calls.get(context.toolCallId)?.group;
					if (group && !group.open) {
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
				call.invalidate = context.invalidate;
				const view = this.view(call.id);
				if (view.nativeExpanded !== context.expanded) {
					view.nativeExpanded = context.expanded;
					view.detailsOpen = undefined;
				}
				if (group.nativeExpanded !== context.expanded) {
					group.nativeExpanded = context.expanded;
					group.open = context.expanded;
				}
				const container = new Container();
				if (group.calls[0]?.id === call.id && group.endedAt !== undefined) {
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
					if (group.stage.summary()) {
						container.addChild({
							invalidate() {},
							render: (width) => [
								truncateToWidth(
									theme.fg("muted", `    ${group.stage.summary()}`),
									width,
								),
							],
						});
					}
				}
				if (rawVisible(context)) {
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
					container.addChild(
						toggleDetails(frame(child, theme, context), context),
					);
				} else if (
					group.open ||
					context.isError ||
					call.status === "error" ||
					call.status === "interrupted"
				) {
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
								1,
								0,
							),
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
