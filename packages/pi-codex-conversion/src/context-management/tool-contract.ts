export const HISTORY_ACTIONS = [
	"list_windows",
	"list_items",
	"read_item",
	"search_contents",
] as const;

export const NOTES_ACTIONS = [
	"list_files_by_prefix",
	"read_file",
	"search_contents",
	"append_to_file",
	"write_file",
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export type NotesAction = (typeof NOTES_ACTIONS)[number];

export const HISTORY_DESCRIPTION =
	"Prior-window detail. Pass IDs unchanged. Search, never browse.";

export const NOTES_DESCRIPTION =
	"Cross-window checkpoints on virtual paths. Relative uses current agent; cross-agent uses <agent>/notes[/path].";

export const HISTORY_NESTED_USAGE =
	"await tools.history({ action, ...args }) // actions(required args): list_windows(); list_items(); read_item(item_id,window_id); search_contents(query)";

export const NOTES_NESTED_USAGE =
	"await tools.notes({ action, ...args }) // actions(required args): list_files_by_prefix(); read_file(path); search_contents(query); append_to_file(path,text); write_file(path,text)";
