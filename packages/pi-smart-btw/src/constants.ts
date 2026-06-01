export const WIDGET_ID = "smart-btw";
export const MESSAGE_TYPE = "BTW SESSION";
export const LEGACY_MESSAGE_TYPE = "smart-btw-result";

export const READY_TIMEOUT = 10_000;
export const RESPONSE_TIMEOUT = 30_000;
export const QUIET_MS = 500;
export const POLL_MS = 150;

export const NUMBERED_SESSION_PATTERN = /^(\d+)(?:\s+(.*))?$/u;
export const MAX_BTW_SESSIONS = 9;

export const KEY_HINT =
	"alt: +z compose · +c inject & clear · +x clear · jk fold · hl switch";

export const DEFAULT_SHORTCUTS = {
	compose: "alt+z",
	inject: "alt+c",
	clear: "alt+x",
	fold: "alt+j",
	unfold: "alt+k",
	next: "alt+l",
	previous: "alt+h",
} as const;

/** @deprecated use DEFAULT_SHORTCUTS */
export const SHORTCUTS = DEFAULT_SHORTCUTS;
