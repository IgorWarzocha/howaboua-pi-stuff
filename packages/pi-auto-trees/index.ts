/** Incremental marker, priming, and branch-summary workflow for Pi. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerPackageChangelog from "./changelog.js";
import { ensureConfigFile } from "./src/config.js";
import { registerTreeSummaryModel } from "./src/tree-summary.js";
import { registerIncrementalWorkflow } from "./src/workflow.js";

export {
	INCREMENTAL_WORKFLOW_MARKER_LABEL,
	INCREMENTAL_WORKFLOW_STATE_ENTRY,
} from "./src/marker-state.js";
export {
	INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT,
	INCREMENTAL_WORKFLOW_DEFAULT_PRIME_SCOPE,
	INCREMENTAL_WORKFLOW_GIT_END_PROMPT,
	INCREMENTAL_WORKFLOW_PRIME_PROMPT,
} from "./src/prompts.js";
export { INCREMENTAL_WORKFLOW_END_WIDGET } from "./src/workflow.js";

export default function (pi: ExtensionAPI): void {
	registerPackageChangelog(pi);
	ensureConfigFile();
	registerIncrementalWorkflow(pi, registerTreeSummaryModel(pi));
}
