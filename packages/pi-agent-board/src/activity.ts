import type {
	ExtensionAPI,
	ExtensionContext,
	MessageRenderer,
	SessionEntry,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { BoardParams } from "./contract.js";

const BOARD_POST_MARKER = "shepherdr-board-post-marker";

export function recordBoardActivityMarker(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	params: BoardParams,
	value: unknown,
	requestId: string,
): void {
	const labels: Partial<Record<BoardParams["action"], string>> = {
		create_channel: "Created board channel",
		post: params.thread_id ? "Posted board reply" : "Created board thread",
		read_thread: "Read board thread",
		read_post: "Read board post",
		list_boards: "Read board list",
		get_channels: "Read board channels",
		list_threads: "Read board threads",
		search_posts: "Searched board posts",
	};
	const label = labels[params.action];
	if (!label || !value || typeof value !== "object") return;
	const result = value as Record<string, unknown>;
	const root = result["root_post"];
	const metadata =
		root && typeof root === "object"
			? (root as Record<string, unknown>)
			: result;
	const field = (key: string) =>
		typeof metadata[key] === "string" ? metadata[key] : undefined;
	if (
		ctx.sessionManager
			.getBranch()
			.some(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === BOARD_POST_MARKER &&
					entry.data &&
					typeof entry.data === "object" &&
					"requestId" in entry.data &&
					entry.data.requestId === requestId,
			)
	)
		return;
	// Owner acknowledgements reach the sender here, never the subscription inbox.
	pi.appendEntry(BOARD_POST_MARKER, {
		operation: params.action,
		label,
		requestId,
		boardId: params.board_id,
		messageId: field("message_id") ?? params.message_id,
		threadId: field("thread_id") ?? params.thread_id,
		channelName:
			field("channel_name") ?? params.channel_name ?? params.new_channel_name,
	});
}

const BOARD_NOTICE = "shepherdr-board-post";
const BOARD_CATCHUP = "shepherdr-board-catchup";

interface BoardRow {
	id: string;
	label: string;
	detail: () => string;
}

function boardRow(entry: SessionEntry): BoardRow | undefined {
	if (
		entry.type === "custom_message" &&
		(entry.customType === BOARD_NOTICE || entry.customType === BOARD_CATCHUP)
	) {
		return {
			id: entry.id,
			label: "Board notice received",
			detail: () =>
				typeof entry.content === "string"
					? entry.content
					: JSON.stringify(entry.content),
		};
	}
	if (entry.type === "custom" && entry.customType === BOARD_POST_MARKER) {
		const data =
			entry.data && typeof entry.data === "object"
				? (entry.data as Record<string, unknown>)
				: undefined;
		const label =
			typeof data?.["label"] === "string" ? data["label"] : "Board action";
		const channel =
			typeof data?.["channelName"] === "string" ? data["channelName"] : "";
		return {
			id: entry.id,
			label: [label, channel]
				.filter(Boolean)
				.join(" · ")
				.replace(/[\r\n\t\x00-\x1f\x7f]/g, " "),
			detail: () => JSON.stringify(entry.data, null, 2) ?? "",
		};
	}
	if (
		entry.type === "message" &&
		entry.message.role === "custom" &&
		(entry.message.customType === BOARD_NOTICE ||
			entry.message.customType === BOARD_CATCHUP)
	) {
		const content = entry.message.content;
		return {
			id: entry.id,
			label: "Board notice received",
			detail: () =>
				typeof content === "string" ? content : JSON.stringify(content),
		};
	}
	return undefined;
}

/** Project existing branch entries only. No new history or model delivery. */
export function registerBoardActivityRenderer(pi: ExtensionAPI): void {
	let sessionManager: ExtensionContext["sessionManager"] | undefined;
	let generation = 0;
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		sessionManager = ctx.sessionManager;
		generation++;
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("session_compact", restore);
	pi.on("session_shutdown", () => {
		sessionManager = undefined;
		cache = undefined;
	});

	interface BoardGroup {
		rows: BoardRow[];
		summary: string;
		details?: string;
	}
	let cache:
		| {
				leaf: string | null;
				generation: number;
				groups: Map<string, BoardGroup>;
				notices: Map<unknown, string>;
		  }
		| undefined;
	const projection = () => {
		const leaf = sessionManager?.getLeafId() ?? null;
		if (cache?.leaf === leaf && cache.generation === generation) return cache;
		const groups = new Map<string, BoardGroup>();
		const notices = new Map<unknown, string>();
		let rows: BoardRow[] = [];
		let running = false;
		const finish = () => {
			if (!rows.length) return;
			const counts = new Map<string, number>();
			for (const row of rows)
				counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
			const group: BoardGroup = {
				rows,
				summary:
					"Board · " +
					[...counts]
						.map(([label, count]) => label + (count > 1 ? ` ×${count}` : ""))
						.join(" · "),
			};
			for (const row of rows) groups.set(row.id, group);
		};
		for (const entry of sessionManager?.getBranch() ?? []) {
			if (
				entry.type === "message" &&
				entry.message.role === "user" &&
				!running
			) {
				finish();
				rows = [];
				running = true;
			}
			if (entry.type === "message" && entry.message.role === "assistant") {
				const message = entry.message;
				// Interrupted partial tool calls do not keep the next kickoff in this run.
				running =
					!["aborted", "error", "length"].includes(message.stopReason) &&
					(message.stopReason === "toolUse" ||
						message.content.some((block) => block.type === "toolCall"));
			}
			const row = boardRow(entry);
			if (!row) continue;
			rows.push(row);
			if (entry.type === "custom_message") notices.set(entry.content, entry.id);
			else if (entry.type === "message" && entry.message.role === "custom")
				notices.set(entry.message.content, entry.id);
		}
		finish();
		cache = { leaf, generation, groups, notices };
		return cache;
	};
	const component = (
		identity: string | { content: unknown },
		expanded: boolean,
		theme: Theme,
		outputPad: number,
		pending?: string,
	) =>
		new (class extends Text {
			private readonly createdGeneration = generation;
			private persisted = false;
			override render(width: number): string[] {
				if (!sessionManager) return [];
				const padding = Math.min(
					outputPad,
					Math.max(0, Math.floor((width - 1) / 2)),
				);
				const contentWidth = Math.max(1, width - padding * 2);
				const current = projection();
				const ownId =
					typeof identity === "string"
						? identity
						: current.notices.get(identity.content);
				const group = ownId ? current.groups.get(ownId) : undefined;
				if (group) this.persisted = true;
				// Streamed custom messages can render before message_end persists them.
				if (
					!group &&
					pending &&
					!this.persisted &&
					this.createdGeneration === generation
				) {
					this.setText(
						theme.style(
							truncateToWidth("Board · Notice received", contentWidth),
							{ fg: "syntaxString", dim: true },
						) + (expanded ? "\n" + pending : ""),
					);
					return super.render(width);
				}
				if (!group || group.rows.at(-1)?.id !== ownId) return [];
				const heading = theme.style(
					truncateToWidth(group.summary, contentWidth),
					{ fg: "syntaxString", dim: true },
				);
				if (expanded)
					group.details ??= group.rows
						.map((row) => row.label + "\n" + row.detail())
						.join("\n\n");
				this.setText(heading + (expanded ? "\n" + group.details : ""));
				return super.render(width);
			}
		})("", outputPad, 0);
	// Pi's entry renderer contract does not expose outputPad; use its default inset.
	pi.registerEntryRenderer(BOARD_POST_MARKER, (entry, { expanded }, theme) =>
		component(entry.id, expanded, theme, 1),
	);
	const incoming: MessageRenderer = (message, { expanded, outputPad }, theme) =>
		component(
			{ content: message.content },
			expanded,
			theme,
			outputPad,
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content),
		);
	pi.registerMessageRenderer(BOARD_NOTICE, incoming);
	pi.registerMessageRenderer(BOARD_CATCHUP, incoming);
}
