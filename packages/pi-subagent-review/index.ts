import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureConfigFile } from "./src/config.js";
import { CHILD_ENV } from "./src/constants.js";
import { registerReviewCommand } from "./src/review-command.js";
import { registerTreeSummaryModel } from "./src/tree-summary.js";

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV] === "1") return;

	ensureConfigFile();
	registerReviewCommand(pi, registerTreeSummaryModel(pi));
}
