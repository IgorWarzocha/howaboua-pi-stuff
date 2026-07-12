import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLearnCommand } from "../commands/learn.js";
import { registerSkillsCommand } from "../commands/skills.js";
import { registerWorkflowsCommand } from "../commands/workflows.js";
import { ensureConfig } from "../config/index.js";
import { registerSubdirContextAutoload } from "../core/subdir.js";
import { registerBeforeAgentStart } from "../hooks/before-agent-start.js";
import { registerWorkflowsCreateTool } from "../tools/workflows-create.js";

export function registerExtension(pi: ExtensionAPI): void {
	const config = ensureConfig();
	registerSubdirContextAutoload(pi);
	if (config.toolRegistration) registerWorkflowsCreateTool(pi);
	registerBeforeAgentStart(pi);
	registerWorkflowsCommand(pi);
	registerSkillsCommand(pi);
	registerLearnCommand(pi);
}
