import {
	type EntryRenderOptions,
	getMarkdownTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	Container,
	Markdown,
	MouseRegion,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

type NoticeOptions = Pick<EntryRenderOptions, "expanded" | "keyHint"> & {
	outputPad?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function compactEntryTitle(
	type: string,
	data: Record<string, unknown> | undefined,
): string | undefined {
	if (
		data?.["protocol"] !== 1 ||
		typeof data["id"] !== "string" ||
		!data["id"].trim() ||
		typeof data["content"] !== "string"
	)
		return undefined;
	if (type === "codex-notebook-status") {
		const title = data["title"];
		return Object.keys(data).every((key) =>
			["protocol", "id", "title", "content"].includes(key),
		) &&
			typeof title === "string" &&
			title.trim() &&
			data["content"].trim()
			? title
			: undefined;
	}
	if (type !== "codex-toolkit-update") return undefined;
	const rootId = data["rootId"];
	const compactionId = data["compactionId"];
	const tools = data["tools"];
	const namespaces = record(data["namespaces"]);
	const unlisted = data["unlisted"];
	if (
		!Object.keys(data).every((key) =>
			[
				"protocol",
				"id",
				"rootId",
				"compactionId",
				"content",
				"tools",
				"namespaces",
				"unlisted",
			].includes(key),
		) ||
		typeof rootId !== "string" ||
		(compactionId !== null && typeof compactionId !== "string") ||
		!Array.isArray(tools) ||
		!tools.every((value: unknown) => {
			const tool = record(value);
			return (
				tool &&
				Object.keys(tool).every((key) =>
					["name", "description", "contract", "namespace"].includes(key),
				) &&
				["name", "description", "contract", "namespace"].every(
					(key) => typeof tool[key] === "string",
				)
			);
		}) ||
		!namespaces ||
		!Object.values(namespaces).every((value) => typeof value === "string") ||
		(unlisted !== undefined &&
			(!Array.isArray(unlisted) ||
				!unlisted.every((value: unknown) => typeof value === "string")))
	)
		return undefined;
	return `${data["id"] === rootId ? "Tools" : "Tools updated"} · ${tools.length}`;
}

export function createCompactNoticeRenderer() {
	const views = new WeakMap<object, { expanded: boolean; open: boolean }>();

	function observe(key: object, expanded: boolean): void {
		// Global expansion can change while Chill hides the native-style notice.
		const state = views.get(key);
		if (state && state.expanded !== expanded) {
			state.expanded = expanded;
			state.open = expanded;
		}
	}

	function render(
		key: object,
		title: string,
		content: string,
		{ expanded, keyHint, outputPad = 1 }: NoticeOptions,
		theme: Theme,
	): MouseRegion {
		// Pi rebuilds the component on invalidation; only a global toggle resets clicks.
		const previous = views.get(key);
		const view = previous ?? { expanded, open: expanded };
		if (previous) observe(key, expanded);
		else views.set(key, view);

		const label = title.replace(/\s+/g, " ").trim();
		const hint = theme.fg(
			"dim",
			` (${keyHint("app.tools.expand", "to expand")})`,
		);
		const hintWidth = visibleWidth(hint);
		const summary = `▸ ${label}`;
		const closed = {
			invalidate() {},
			render(width: number) {
				const titleWidth = width - hintWidth;
				const showHint = titleWidth >= 6;
				const text = truncateToWidth(
					summary,
					showHint ? titleWidth : width,
					"…",
				);
				return [theme.fg("customMessageLabel", text) + (showHint ? hint : "")];
			},
		};
		const opened = new Container();
		opened.addChild(
			new Text(theme.fg("customMessageLabel", `▾ ${label}`), 0, 0),
		);
		opened.addChild(
			new Markdown(content, 0, 0, getMarkdownTheme(), {
				color: (text) => theme.fg("customMessageText", text),
			}),
		);
		let pad = 0;
		let open: boolean | undefined;
		const box = new (class extends Box {
			override render(width: number): readonly string[] {
				if (width < 1) return [];
				const nextPad = Math.min(outputPad, Math.floor((width - 1) / 2));
				if (pad !== nextPad) this.setPaddingX((pad = nextPad));
				if (open !== view.open) {
					open = view.open;
					this.clear();
					this.addChild(open ? opened : closed);
				}
				return super.render(width);
			}
		})(0, 0, (text) => theme.bg("customMessageBg", text));
		return new MouseRegion(box, (event) => {
			if (event.type !== "click" || event.button !== "left") return undefined;
			view.open = !view.open;
			return { handled: true };
		});
	}

	return { observe, render };
}
