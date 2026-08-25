import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { CHILD_ENV } from "./src/constants.js";
import { registerExploreTool } from "./src/explore-tool.js";

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV] === "1") return;

	registerPackageChangelog(pi);
	registerExploreTool(pi);
}
