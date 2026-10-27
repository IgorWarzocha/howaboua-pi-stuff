import {
	getMarkdownTheme,
	type MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Markdown,
	MouseRegion,
	TruncatedText,
} from "@earendil-works/pi-tui";

export function watchNoticeRenderer(): MessageRenderer {
	const views = new WeakMap<object, { expanded: boolean; open: boolean }>();
	return (message, { expanded, outputPad }, theme) => {
		if (typeof message.content !== "string") return undefined;
		// Recognise the complete watcher result, not arbitrary text claiming success.
		const match = message.content.match(
			/^GitHub Actions: ([a-z_]+) \(attempt (\d+)\) at (https:\/\/github\.com\/([^\s/]+\/[^\s/]+)\/actions\/runs\/(\d+))\. Read details with gh run view \5 --repo \4\.$/,
		);
		if (!match) return undefined;
		const [, conclusion, attempt, , repo, run] = match;
		let view = views.get(message);
		if (!view) {
			view = { expanded, open: expanded };
			views.set(message, view);
		} else if (view.expanded !== expanded) {
			view.expanded = expanded;
			view.open = expanded;
		}
		const state = view;
		const label = `GitHub Actions · ${conclusion} · run ${run} · ${repo} · attempt ${attempt}`;
		const colour = conclusion === "success" ? "muted" : "warning";
		const heading = (open: boolean) =>
			new TruncatedText(
				theme.fg(colour, `${open ? "▾" : "▸"} ${label}`),
				outputPad,
				0,
			);
		const closed = heading(false);
		const opened = new Container();
		opened.addChild(heading(true));
		opened.addChild(
			new Markdown(message.content, outputPad, 0, getMarkdownTheme()),
		);
		let cached: { width: number; open: boolean; lines: string[] } | undefined;
		const component = {
			invalidate() {
				cached = undefined;
				closed.invalidate();
				opened.invalidate();
			},
			render(width: number) {
				if (cached?.width !== width || cached.open !== state.open) {
					cached = {
						width,
						open: state.open,
						lines: (state.open ? opened : closed).render(width),
					};
				}
				return cached.lines;
			},
		};
		return new MouseRegion(component, (event) => {
			if (event.type !== "click" || event.button !== "left" || event.y !== 0)
				return undefined;
			state.open = !state.open;
			component.invalidate();
			return { handled: true };
		});
	};
}
