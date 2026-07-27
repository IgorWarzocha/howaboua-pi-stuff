import type { TreeNavigationOptions } from "./tree-summary.js";

export const INCREMENTAL_WORKFLOW_DEFAULT_PRIME_SCOPE =
	"the current repository";
export const INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT = [
	"Treat this as a finished work increment that should become durable context for continuing the same repository session.",
	"Focus on the final accepted outcome, not dead ends or step-by-step implementation noise.",
	"Capture the concrete code or repo changes, key decisions, important constraints, and any follow-up that still matters.",
	"Mention relevant files, commands, commits, PR outcomes, or review feedback only when they change future work.",
	"Omit temporary debugging details, abandoned attempts, and incidental churn that no longer matters.",
	"Write the summary so a future agent can continue from the repo familiarization and planning context plus this completed increment.",
].join("\n");
export const INCREMENTAL_WORKFLOW_PRIME_PROMPT = [
	"Prime yourself on the requested scope.",
	"Work directly and do not use subagents.",
	"Trace the main call flow, identify ownership, state, and effects, and note the important files and boundaries.",
	"Stay repo-local; do not inspect dependencies.",
	"For broad scopes, list paths first; narrow search paths before tight queries, follow direct references only, and stop once the scoped boundary is clear.",
	"Finish with a concise orientation briefing and stop. Do not implement anything unless explicitly asked.",
	"Skip README.md unless the scoped source and configuration contain no useful priming material; read it when the scope explicitly targets documentation.",
].join("\n");
export const INCREMENTAL_WORKFLOW_GIT_END_PROMPT = [
	INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT,
	"Also explicitly capture the git commit that should be made for the completed changes, including a concise commit subject and any important commit-body notes.",
].join("\n");

type EndMode =
	| { mode: "default" }
	| { mode: "git" }
	| { mode: "full" }
	| { mode: "custom"; prompt: string };

function parseEndMode(args: string): EndMode {
	const trimmed = args.trim();
	if (!trimmed) return { mode: "default" };
	if (trimmed.toLowerCase() === "git") return { mode: "git" };
	if (trimmed.toLowerCase() === "full") return { mode: "full" };
	return { mode: "custom", prompt: trimmed };
}

export function buildPrimePrompt(scope: string): string {
	return `${INCREMENTAL_WORKFLOW_PRIME_PROMPT}\n\nScope: ${scope}`;
}

export function buildEndNavigationOptions(args: string): TreeNavigationOptions {
	const mode = parseEndMode(args);
	switch (mode.mode) {
		case "full":
			return { summarize: true };
		case "git":
			return {
				summarize: true,
				customInstructions: INCREMENTAL_WORKFLOW_GIT_END_PROMPT,
				replaceInstructions: false,
			};
		case "custom": {
			return {
				summarize: true,
				customInstructions: mode.prompt,
				replaceInstructions: false,
			};
		}
		case "default":
			return {
				summarize: true,
				customInstructions: INCREMENTAL_WORKFLOW_DEFAULT_END_PROMPT,
				replaceInstructions: false,
			};
	}
}
