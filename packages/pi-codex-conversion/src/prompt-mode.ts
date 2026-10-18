import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PREPARE = "@howaboua/pi-codex-conversion.prompt-mode-prepare/v1";
const REQUEST = "@howaboua/pi-codex-conversion.prompt-mode-request/v1";
const CAPTURE = "@howaboua/pi-codex-conversion.prompt-mode-capture/v1";

export interface PromptModeToolMetadata {
	name: string;
	promptSnippet?: string | undefined;
	promptGuidelines?: string[] | undefined;
}

export type GptPromptModeHandler = (
	active: boolean,
	context: ExtensionContext | undefined,
) => readonly PromptModeToolMetadata[] | void;

export interface GptPromptModeRegistration {
	readonly active: boolean;
	dispose(): void;
}

interface Preparation {
	active: boolean;
	context: ExtensionContext | undefined;
	errors: unknown[];
	add(tools: readonly PromptModeToolMetadata[]): void;
}

function isPreparation(value: unknown): value is Preparation {
	return Boolean(value && typeof value === "object" && "active" in value &&
		typeof value.active === "boolean" && "context" in value &&
		"errors" in value && Array.isArray(value.errors) &&
		"add" in value && typeof value.add === "function");
}

/** Supply owned alternate prose, not schemas or arbitrary prompt transformations.
 * Called synchronously before capture, including when the mode has not changed.
 * Return current native definitions to refresh Pi's already-cloned prompt metadata.
 * Without PCC the callback receives false and standalone contracts stay intact.
 */
export function registerGptPromptMode(
	pi: ExtensionAPI,
	apply: GptPromptModeHandler,
): GptPromptModeRegistration {
	let active = false;
	let disposed = false;
	let handlerFailure: { error: unknown } | undefined;
	const prepare = (value: unknown) => {
		if (disposed || !isPreparation(value)) return;
		active = value.active;
		try {
			const tools = apply(active, value.context);
			if (tools) value.add(tools);
		} catch (error) {
			handlerFailure = { error };
			value.errors.push(error);
		}
	};
	// Install first so a broker loaded later can discover this adopter.
	const stop = pi.events.on(PREPARE, prepare);
	try {
		apply(false, undefined);
		pi.events.emit(REQUEST, prepare);
		if (handlerFailure) throw handlerFailure.error;
	} catch (error) {
		stop();
		throw error;
	}
	const registration: GptPromptModeRegistration = {
		get active() { return !disposed && active; },
		dispose() {
			if (disposed) return;
			disposed = true;
			stop();
		},
	};
	pi.on("session_shutdown", () => registration.dispose());
	return registration;
}

interface PromptMetadataOptions {
	toolSnippets: Record<string, string>;
	toolGuidelines: Record<string, string[]>;
}

/** Code/Notebook may register before PCC; request preparation at their capture boundary. */
export function prepareGptPromptMode(
	pi: ExtensionAPI,
	context: ExtensionContext,
	options?: PromptMetadataOptions,
): void {
	const request = { context, options, errors: [] as unknown[] };
	pi.events.emit(CAPTURE, request);
	if (request.errors.length) throw new AggregateError(request.errors, "Could not prepare tool guidance");
}

/** PCC composition-root API; all selection policy stays with its runtime plan. */
export function registerGptPromptModeBroker(
	pi: ExtensionAPI,
	isActive: (context: ExtensionContext) => boolean,
): { prepare(context: ExtensionContext, options?: PromptMetadataOptions): void; dispose(): void } {
	let latest: Preparation = { active: false, context: undefined, errors: [], add() {} };
	const stop = pi.events.on(REQUEST, (value) => {
		if (typeof value === "function") value(latest);
	});
	const prepare = (context: ExtensionContext, options?: PromptMetadataOptions) => {
		latest = {
			active: isActive(context), context, errors: [],
			add(tools) {
				if (!options) return;
				for (const tool of tools) {
					const snippet = tool.promptSnippet?.replace(/\s+/g, " ").trim();
					if (snippet) options.toolSnippets[tool.name] = snippet;
					else delete options.toolSnippets[tool.name];
					const guidelines = [...new Set((tool.promptGuidelines ?? []).map(line => line.trim()).filter(Boolean))];
					if (guidelines.length) options.toolGuidelines[tool.name] = guidelines;
					else delete options.toolGuidelines[tool.name];
				}
			},
		};
		pi.events.emit(PREPARE, latest);
		const errors = latest.errors;
		// Do not retain a mutable prompt snapshot for later registration requests.
		latest = { ...latest, errors: [], add() {} };
		if (errors.length) throw new AggregateError(errors, "Could not prepare tool guidance");
	};
	const stopCapture = pi.events.on(CAPTURE, (value) => {
		if (!value || typeof value !== "object" || !("context" in value)) return;
		const request = value as { context: ExtensionContext; options?: PromptMetadataOptions; errors: unknown[] };
		if (!Array.isArray(request.errors)) return;
		try { prepare(request.context, request.options); }
		catch (error) { request.errors.push(error); }
	});
	return {
		prepare,
		dispose() { stop(); stopCapture(); },
	};
}
