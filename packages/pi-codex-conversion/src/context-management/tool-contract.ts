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
	"Search earlier conversation";

export const HISTORY_GUIDANCE =
	"Search earlier conversation, don't browse it. Pass returned IDs unchanged";

export const NOTES_DESCRIPTION =
	"Persistent notes";

export const NOTES_GUIDANCE =
	"write_file replaces; append_to_file adds. Virtual paths: relative uses current agent; cross-agent uses <agent>/notes[/path].";
