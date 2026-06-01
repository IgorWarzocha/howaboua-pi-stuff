export const WIDGET_ID = "smart-btw";
export const MESSAGE_TYPE = "BTW SESSION";
export const LEGACY_MESSAGE_TYPE = "smart-btw-result";

export const READY_TIMEOUT = 10_000;
export const RESPONSE_TIMEOUT = 30_000;
export const QUIET_MS = 500;
export const POLL_MS = 150;

export const NUMBERED_SESSION_PATTERN = /^(\d+)(?:\s+(.*))?$/u;

export const KEY_HINT =
	"alt: +z compose · +c inject & clear · +x clear · ↑/↓ fold · ←/→ switch";

export const SHORTCUTS = {
	compose: "alt+z",
	inject: "alt+c",
	clear: "alt+x",
	fold: "alt+down",
	unfold: "alt+up",
	next: "alt+right",
	previous: "alt+left",
} as const;
