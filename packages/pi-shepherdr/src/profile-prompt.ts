import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PROFILE_PROMPT_FLAG = "shepherdr-profile-prompt";
const SECTION = "shepherdr_profile";

export function registerProfilePrompt(pi: ExtensionAPI): void {
	pi.registerFlag(PROFILE_PROMPT_FLAG, {
		type: "string",
		description: "JSON-encoded worker profile prompt",
	});
	pi.on("before_agent_start", async (event, ctx) => {
		const encoded = pi.getFlag(PROFILE_PROMPT_FLAG);
		if (encoded === undefined) return;
		let prompt: unknown;
		try {
			prompt = JSON.parse(String(encoded));
			if (typeof prompt !== "string") throw new Error("Expected a string");
		} catch (cause) {
			await ctx.abort();
			throw new Error("Worker profile prompt is invalid; respawn the worker", {
				cause,
			});
		}
		// Custom sections follow shared project context. Never relocate foreign addenda.
		const options = event.systemPromptOptions;
		if (options.forceSystemPrompt !== undefined) {
			options.forceSystemPrompt += `\n\n<${SECTION}>\n${prompt}\n</${SECTION}>`;
		} else {
			options.sections[SECTION] = prompt;
		}
	});
}
