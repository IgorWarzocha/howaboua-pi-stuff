import { Container, Text } from "@earendil-works/pi-tui";
import {
	auxiliaryToolRenderers,
	displayRecord,
	inlineToolText,
} from "../ui/tool-rendering/auxiliary-tool.ts";
import { renderCodexToolCell } from "../ui/tool-rendering/codex-tool-cell.ts";
import type { RenderTheme } from "../ui/tool-rendering/codex-rendering.ts";
import type { CodexContextManagementMessageDetails } from "./messages.ts";

const NOTE_TITLES: Record<string, { active: string; complete: string }> = {
	list_files_by_prefix: { active: "Listing notes", complete: "Listed notes" },
	read_file: { active: "Reading note", complete: "Read note" },
	search_contents: { active: "Searching notes", complete: "Searched notes" },
	append_to_file: { active: "Appending to note", complete: "Appended to note" },
	write_file: { active: "Saving note", complete: "Saved note" },
};
const HISTORY_TITLES: Record<string, { active: string; complete: string }> = {
	list_windows: { active: "Listing context windows", complete: "Listed context windows" },
	list_items: { active: "Listing history", complete: "Listed history" },
	read_item: { active: "Reading history", complete: "Read history" },
	search_contents: { active: "Searching history", complete: "Searched history" },
};

export function historyNotesRenderers(namespace: "history" | "notes") {
	return auxiliaryToolRenderers(`${namespace === "notes" ? "Notes" : "History"} operation failed`, (args, result) => {
		const action = String(args["action"] ?? "");
		const titles = (namespace === "notes" ? NOTE_TITLES : HISTORY_TITLES)[action]
			?? { active: `Using ${namespace}`, complete: `Used ${namespace}` };
		const target = namespace === "notes"
			? inlineToolText(args["path"] ?? args["prefix"] ?? args["path_prefix"])
			: [inlineToolText(args["item_id"]), inlineToolText(args["window_id"])].filter(Boolean).join(" · ") || undefined;
		if (!result) return { ...titles, target };
		const data = displayRecord(displayRecord(result.details)["codexHistoryNotes"]);
		if (typeof data["encrypted_output"] === "string") {
			return { ...titles, target, summary: "Encrypted result", body: "Codex returned an encrypted result readable by the model. Plaintext is not available in this UI." };
		}
		const file = displayRecord(data["file"]);
		const item = displayRecord(data["item"]);
		const entries = data["files"] ?? data["windows"] ?? data["items"];
		let summary: string | undefined;
		if (Array.isArray(entries)) {
			const noun = namespace === "notes" ? "note" : action === "list_windows" ? "window" : "item";
			summary = `${entries.length} ${noun}${entries.length === 1 ? "" : "s"} returned`;
		} else if (typeof file["bytes"] === "number") summary = `${file["bytes"].toLocaleString("en-US")} bytes`;
		else if (typeof data["returned_lines"] === "number") summary = `${data["returned_lines"]} lines returned`;
		if (typeof file["start_line"] === "number" && typeof file["stop_line"] === "number") summary = `Lines ${file["start_line"]}–${file["stop_line"]} of ${file["total_lines"]}`;
		if (typeof item["content"] === "string") summary = `${inlineToolText(item["role"]) ?? "History"} · ${item["content"].length.toLocaleString("en-US")} characters returned${item["next_offset_chars"] === undefined ? "" : " · more available"}`;
		// Remote queries and note contents can be encrypted arguments; only local results prove they are plaintext.
		const query = data["source"] === "pi-session" ? inlineToolText(args["query"]) : undefined;
		if (query) summary = [JSON.stringify(query), summary].filter(Boolean).join(" · ");
		const body = typeof file["content"] === "string" ? file["content"] : typeof item["content"] === "string" ? item["content"] : JSON.stringify(data, null, 2);
		return { ...titles, target, summary, body, ...(data["file"] === null ? { warning: "Note not found" } : data["item"] === null ? { warning: "History item not found" } : {}) };
	});
}

export const newContextRenderers = auxiliaryToolRenderers("Context rollover failed", (_args, result) => ({
	active: "Requesting new context window",
	complete: "Requested new context window",
	...(result ? {
		summary: displayRecord(result.details)["started"] === false ? "Already scheduled · environment unchanged" : "Rollover scheduled · environment unchanged",
		body: "",
	} : {}),
}));

export const contextRemainingRenderers = auxiliaryToolRenderers("Context check failed", (_args, result) => {
	const details = displayRecord(result?.details);
	const remaining = details["remainingTokens"];
	const size = details["contextWindow"];
	return {
		active: "Checking context budget",
		complete: "Checked context budget",
		...(result ? {
			summary: typeof remaining === "number"
				? `${remaining.toLocaleString("en-US")} tokens left${typeof size === "number" && size > 0 ? ` · ${Math.round(remaining / size * 100)}% of window` : ""}`
				: "Remaining token budget unknown",
			body: "",
		} : {}),
	};
});

export function renderContextWindowBoundary(details: CodexContextManagementMessageDetails, expanded: boolean, theme: RenderTheme): Text | Container {
	const window = details.contextManagement;
	const cell = renderCodexToolCell(`Started context window ${window.windowNumber + 1}`, window.previousWindowId
		? "Previous history searchable · environment unchanged"
		: "Environment unchanged", theme);
	if (!expanded) return cell;
	const expandedCell = new Container();
	expandedCell.addChild(cell);
	expandedCell.addChild(new Text([
		theme.fg("dim", `    Current: ${window.currentWindowId}`),
		...(window.previousWindowId ? [theme.fg("dim", `    Previous: ${window.previousWindowId}`), theme.fg("dim", "    No conversation summary generated")] : []),
	].join("\n"), 0, 0));
	return expandedCell;
}
