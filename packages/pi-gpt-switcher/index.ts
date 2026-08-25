/** Pi package entry point for the Codex model shortcut extension. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import registerCodexModelShortcuts from "./codex-model-shortcuts.js";

export default function gptSwitcher(
	pi: ExtensionAPI,
	options: Parameters<typeof registerCodexModelShortcuts>[1] = {},
): void {
	registerPackageChangelog(pi);
	registerCodexModelShortcuts(pi, options);
}
