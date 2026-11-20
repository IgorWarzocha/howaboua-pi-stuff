import type {
	EntryRenderer,
	MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import type { ActivityTimeline } from "../activity/timeline.js";
import {
	compactEntryTitle,
	createCompactNoticeRenderer,
} from "./compact-notice.js";
import { renderActivityHeading } from "./heading.js";

type CustomMessage = Parameters<MessageRenderer>[0];

function textContent(message: CustomMessage): string {
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function unescapeAttribute(value: string): string {
	const entities: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		"#10": "\n",
		"#13": "\r",
	};
	return value.replace(
		/&(amp|lt|gt|quot|apos|#10|#13);/g,
		(_, key: string) => entities[key] ?? "",
	);
}

function peerContent(
	content: string,
): { identity: string; body: string } | undefined {
	// Peer inbox owns exactly one leading sender line. Never strip envelope-like body text.
	const envelope = content.match(
		/^<herdr_sender ((?:[a-z_]+="[^"\n]*" )+)\/>\n/,
	);
	if (!envelope?.[1]) return undefined;
	const source = Object.fromEntries(
		[...envelope[1].matchAll(/([a-z_]+)="([^"]*)" /g)].map(([, key, value]) => [
			key,
			unescapeAttribute(value ?? ""),
		]),
	);
	const machine = source["machine"] || source["host"];
	const terminal = source["terminal"] || source["pane"];
	if (
		(source["kind"] !== "message" && source["kind"] !== "task") ||
		!machine ||
		!terminal
	)
		return undefined;
	const name =
		source["name"] || source["pane_name"] || source["tab_name"] || terminal;
	return {
		identity: `${name} (${machine})`,
		body: content.slice(envelope[0].length),
	};
}

function eventContent(
	details: unknown,
	original: string,
): { label: string; body: string; warning: boolean } | undefined {
	const value = record(details);
	const state = value?.["state"];
	if (
		!value ||
		typeof value["paneId"] !== "string" ||
		![
			"blocked",
			"question",
			"failed",
			"finished",
			"extension-message",
		].includes(String(state))
	)
		return undefined;
	const string = (key: string) =>
		typeof value[key] === "string" ? (value[key] as string) : "";
	const identity = [
		string("machineLabel") || string("machine"),
		string("name") || string("paneId"),
	]
		.filter(Boolean)
		.join(" / ");
	const stateLabel =
		state === "extension-message"
			? "extension message pending"
			: state === "question"
				? "question pending"
				: state;
	const label = `${identity} · ${stateLabel}`;
	const fields = [
		string("task"),
		string("blockedOn"),
		string("response"),
	].filter(Boolean);
	const ask = record(value["ask"]);
	if (ask) fields.push(JSON.stringify(ask, null, 2));
	return {
		label,
		body: state === "extension-message" ? original : fields.join("\n\n"),
		warning: state !== "finished",
	};
}

export function activityMessageRenderer(
	timeline: ActivityTimeline,
	isEnabled: () => boolean = () => true,
): MessageRenderer {
	const nativeExpansion = new WeakMap<
		object,
		{ expanded: boolean; generation: number }
	>();
	const compactNotice = createCompactNoticeRenderer();
	return (message, { expanded, outputPad, keyHint }, theme) => {
		compactNotice.observe(message, expanded);
		const id = timeline.messageId(message);
		const group = timeline.addMessage(message);
		const member = group.members.get(id);
		const previousExpansion = nativeExpansion.get(message);
		nativeExpansion.set(message, {
			expanded,
			generation: timeline.renderGeneration,
		});
		if (
			previousExpansion?.generation === timeline.renderGeneration &&
			previousExpansion.expanded !== expanded
		) {
			group.nativeExpansion(expanded, id);
		}
		const original = textContent(message);
		const peer =
			message.customType === "herdr-agent-message"
				? peerContent(original)
				: undefined;
		const event =
			message.customType === "herdr-agent-event"
				? eventContent(message.details, original)
				: undefined;
		const label = peer
			? `message from ${peer.identity}`
			: (event?.label ??
				(message.customType === "herdr-agent-message"
					? "agent message"
					: message.customType === "herdr-agent-event"
						? "agent update"
						: undefined));
		if (label) group.notices.set(id, label);
		if (event?.warning) group.noticeWarnings.add(id);
		const heading = renderActivityHeading(group, theme, outputPad);
		const originalText = new Text(original, outputPad, 0);
		const detail = expanded
			? original
			: (peer?.body ?? (event?.body || original));
		const detailText =
			detail === original ? originalText : new Text(detail, outputPad, 0);
		const labelText = new Text("", outputPad, 0);
		const updateLabel = () =>
			labelText.setText(
				label ? theme.fg(event?.warning ? "warning" : "muted", label) : "",
			);
		updateLabel();
		const hint =
			!expanded && event
				? original.match(
						/(?:^|\n)<operator_hint>([^<]*)<\/operator_hint>(?:\n|$)/,
					)?.[1]
				: undefined;
		const hintText = hint
			? new Text(unescapeAttribute(hint), outputPad, 0)
			: undefined;
		const title = record(message.details)?.["title"];
		let offNotice: Component | undefined;
		const component = new (class extends Container {
			override invalidate(): void {
				// The heading may be detached while another row anchors the group.
				heading.invalidate();
				offNotice?.invalidate();
				updateLabel();
				super.invalidate();
			}

			override render(width: number): readonly string[] {
				this.clear();
				if (!isEnabled()) {
					if (
						message.customType === "codex-developer-message" &&
						typeof message.content === "string"
					) {
						offNotice ??= compactNotice.render(
							message,
							typeof title === "string" ? title : "Context update",
							message.content,
							{ expanded, keyHint, outputPad },
							theme,
						);
						this.addChild(offNotice);
					} else this.addChild(originalText);
					return super.render(width);
				}
				if (group.anchorId === id) this.addChild(heading);
				if (group.open || (group.anchorId === undefined && expanded)) {
					if (!expanded && label) this.addChild(labelText);
					this.addChild(detailText);
					if (hintText) this.addChild(hintText);
				}
				return super.render(width);
			}
		})();
		if (member) {
			member.invalidate = () => component.invalidate();
			member.invalidateHeading = () => heading.invalidate();
		}
		if (isEnabled()) group.refreshHeading();
		return component;
	};
}

export function activityEntryRenderer(
	timeline: ActivityTimeline,
	isEnabled: () => boolean = () => true,
): EntryRenderer {
	const nativeExpansion = new WeakMap<
		object,
		{ expanded: boolean; generation: number }
	>();
	const compactNotice = createCompactNoticeRenderer();
	return (entry, { expanded, keyHint }, theme) => {
		compactNotice.observe(entry, expanded);
		const id = `entry:${entry.id}`;
		const group = timeline.addEntry(entry);
		const previous = nativeExpansion.get(entry);
		nativeExpansion.set(entry, {
			expanded,
			generation: timeline.renderGeneration,
		});
		if (
			previous?.generation === timeline.renderGeneration &&
			previous.expanded !== expanded
		)
			group.nativeExpansion(expanded, id);
		const data = record(entry.data);
		let serialized: string | undefined;
		const raw = () =>
			(serialized ??= JSON.stringify(entry.data, null, 2) ?? "");
		const title = typeof data?.["title"] === "string" ? data["title"] : "";
		const content =
			typeof data?.["content"] === "string" ? data["content"] : raw();
		const readable = [title, content].filter(Boolean).join("\n");
		if (
			entry.customType === "codex-notebook-status" &&
			(title === "Notebook status unavailable" ||
				title === "TS status unavailable")
		) {
			group.notices.set(id, title);
			group.noticeWarnings.add(id);
		}
		const heading = renderActivityHeading(group, theme);
		const readableText = new Text(readable, 1, 0);
		let rawText: Text | undefined;
		const details = () => (rawText ??= new Text(raw(), 1, 0));
		let compactTitle: string | null | undefined;
		let offNotice: Component | undefined;
		const component = new (class extends Container {
			override invalidate(): void {
				heading.invalidate();
				offNotice?.invalidate();
				super.invalidate();
			}

			override render(width: number): readonly string[] {
				this.clear();
				if (!isEnabled()) {
					compactTitle ??= compactEntryTitle(entry.customType, data) ?? null;
					if (compactTitle) {
						offNotice ??= compactNotice.render(
							entry,
							compactTitle,
							content,
							{ expanded, keyHint },
							theme,
						);
						this.addChild(offNotice);
					} else {
						const compaction =
							entry.customType === "codex-native-compaction-display" &&
							typeof data?.["content"] === "string";
						this.addChild(expanded && !compaction ? details() : readableText);
					}
				} else {
					if (group.anchorId === id) this.addChild(heading);
					if (group.open || (group.anchorId === undefined && expanded))
						this.addChild(expanded ? details() : readableText);
				}
				return super.render(width);
			}
		})();
		const member = group.members.get(id);
		if (member) {
			member.invalidate = () => component.invalidate();
			member.invalidateHeading = () => heading.invalidate();
		}
		if (isEnabled()) group.refreshHeading();
		return component;
	};
}
