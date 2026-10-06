import type {
	EntryRenderer,
	MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { ActivityTimeline } from "./activity.js";
import { renderActivityHeading } from "./renderers.js";

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
	if (
		(source["kind"] !== "message" && source["kind"] !== "task") ||
		!source["host"] ||
		!source["pane"]
	)
		return undefined;
	const name =
		source["name"] ||
		source["pane_name"] ||
		source["tab_name"] ||
		source["pane"];
	return {
		identity: `${name} (${source["host"]})`,
		body: content.slice(envelope[0].length),
	};
}

function eventContent(
	details: unknown,
): { label: string; body: string; warning: boolean } | undefined {
	const value = record(details);
	const state = value?.["state"];
	if (
		!value ||
		typeof value["paneId"] !== "string" ||
		!["blocked", "question", "failed", "finished"].includes(String(state))
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
	const label = `${identity} · ${state === "question" ? "question pending" : state}`;
	const fields = [
		string("task"),
		string("blockedOn"),
		string("response"),
	].filter(Boolean);
	const ask = record(value["ask"]);
	if (ask) fields.push(JSON.stringify(ask, null, 2));
	return { label, body: fields.join("\n\n"), warning: state !== "finished" };
}

export function activityMessageRenderer(
	timeline: ActivityTimeline,
	isEnabled: () => boolean = () => true,
): MessageRenderer {
	const nativeExpansion = new WeakMap<
		object,
		{ expanded: boolean; generation: number }
	>();
	return (message, { expanded, outputPad }, theme) => {
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
				? eventContent(message.details)
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
		const component = new (class extends Container {
			override render(width: number): string[] {
				this.clear();
				if (!isEnabled()) {
					this.addChild(new Text(original, outputPad, 0));
					return super.render(width);
				}
				if (group.anchorId === id)
					this.addChild(renderActivityHeading(group, theme, outputPad));
				if (group.open || (group.anchorId === undefined && expanded)) {
					if (!expanded && label)
						this.addChild(
							new Text(
								theme.fg(event?.warning ? "warning" : "muted", label),
								outputPad,
								0,
							),
						);
					this.addChild(
						new Text(
							expanded ? original : (peer?.body ?? (event?.body || original)),
							outputPad,
							0,
						),
					);
					if (!expanded && event) {
						const hint = original.match(
							/(?:^|\n)<operator_hint>([^<]*)<\/operator_hint>(?:\n|$)/,
						)?.[1];
						if (hint)
							this.addChild(new Text(unescapeAttribute(hint), outputPad, 0));
					}
				}
				return super.render(width);
			}
		})();
		if (member) member.invalidate = () => component.invalidate();
		group.refresh();
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
	return (entry, { expanded }, theme) => {
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
		const raw = JSON.stringify(entry.data, null, 2) ?? "";
		const title = typeof data?.["title"] === "string" ? data["title"] : "";
		const content =
			typeof data?.["content"] === "string" ? data["content"] : raw;
		if (
			entry.customType === "codex-notebook-status" &&
			title === "Notebook status unavailable"
		) {
			group.notices.set(id, title);
			group.noticeWarnings.add(id);
		}
		const component = new (class extends Container {
			override render(width: number): string[] {
				this.clear();
				if (!isEnabled())
					this.addChild(
						new Text([title, content].filter(Boolean).join("\n"), 1, 0),
					);
				else {
					if (group.anchorId === id)
						this.addChild(renderActivityHeading(group, theme));
					if (group.open || (group.anchorId === undefined && expanded))
						this.addChild(
							new Text(
								expanded ? raw : [title, content].filter(Boolean).join("\n"),
								1,
								0,
							),
						);
				}
				return super.render(width);
			}
		})();
		const member = group.members.get(id);
		if (member) member.invalidate = () => component.invalidate();
		group.refresh();
		return component;
	};
}
