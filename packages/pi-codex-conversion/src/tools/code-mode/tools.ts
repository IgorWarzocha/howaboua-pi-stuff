import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type CustomToolDiscoveryError,
	discoverCustomToolsFromDirectories,
	getCustomToolsDir,
	getProjectCustomToolsDir,
} from "./custom-tools.js";
import { registerPublicCodeModeTools } from "./public-tools.js";
import {
	SharedCodeModeRuntime,
	type CodeModeToolProvider,
} from "./shared-runtime.js";
import { registerCodeModeEvents } from "./tool-events.js";

// Providers in one extension instance share a process-lifetime host runtime.
// Pi replaces ExtensionAPI registrations on reload, so each API binds its own surface.
const REGISTRATION_KEY = Symbol.for("@howaboua/pi-codex-conversion.code-mode");

interface CodeModeProcessState {
	runtime: SharedCodeModeRuntime;
	boundApis: WeakSet<object>;
}

export interface RegisterCodeModeToolsOptions extends CodeModeToolProvider {}

export interface CodeModeRegistration {
	prepare(ctx?: unknown): Promise<void> | undefined;
	shutdownHost(): Promise<void>;
	shutdown(): Promise<void>;
}

export async function registerCustomTools(
	pi: ExtensionAPI,
	toolsDir?: string | readonly string[],
	options: { isActive?(ctx: unknown): boolean } = {},
): Promise<CodeModeRegistration> {
	const usesDefaultDirs = toolsDir === undefined;
	const toolsDirs =
		toolsDir === undefined
			? [getCustomToolsDir(), getProjectCustomToolsDir()]
			: typeof toolsDir === "string"
				? [toolsDir]
				: [...toolsDir];
	let previousErrors = new Map<string, string>();
	return registerCodeModeTools(pi, {
		getTools: (ctx) => {
			const activeDirs =
				usesDefaultDirs && !isTrustedProjectContext(ctx)
					? toolsDirs.slice(0, 1)
					: toolsDirs;
			const discovery = discoverCustomToolsFromDirectories(activeDirs);
			previousErrors = reportCustomToolErrors(
				ctx,
				discovery.errors,
				previousErrors,
			);
			return discovery.tools;
		},
		documentationPath: customToolsDocumentationPath(),
		...options,
	});
}

function reportCustomToolErrors(
	ctx: unknown,
	errors: CustomToolDiscoveryError[],
	previous: Map<string, string>,
): Map<string, string> {
	if (!isExtensionContext(ctx)) return previous;
	const current = new Map(errors.map((error) => [error.path, error.message]));
	for (const error of errors) {
		if (previous.get(error.path) === error.message) continue;
		ctx.ui.notify(`Code Mode custom tool disabled: ${error.message}`, "error");
	}
	return current;
}

function isExtensionContext(value: unknown): value is ExtensionContext {
	return Boolean(
		value &&
			typeof value === "object" &&
			"ui" in value &&
			value.ui &&
			typeof value.ui === "object" &&
			"notify" in value.ui &&
			typeof value.ui.notify === "function",
	);
}

function isTrustedProjectContext(value: unknown): value is ExtensionContext {
	return Boolean(
		value &&
			typeof value === "object" &&
			"isProjectTrusted" in value &&
			typeof value.isProjectTrusted === "function" &&
			value.isProjectTrusted(),
	);
}

export async function registerCodeModeTools(
	pi: ExtensionAPI,
	options: RegisterCodeModeToolsOptions,
): Promise<CodeModeRegistration> {
	const runtime = await getOrCreateRuntime(pi);
	const providerId = runtime.addProvider(options);
	let active = true;
	return {
		prepare: (ctx) => runtime.prepare(ctx),
		shutdownHost: () => runtime.shutdownHost(),
		async shutdown() {
			if (!active) return;
			active = false;
			runtime.removeProvider(providerId);
			if (runtime.providers.size === 0) await runtime.shutdownHost();
		},
	};
}

async function getOrCreateRuntime(pi: ExtensionAPI): Promise<SharedCodeModeRuntime> {
	const state = pi.events as typeof pi.events & {
		[REGISTRATION_KEY]?: CodeModeProcessState | SharedCodeModeRuntime;
	};
	const existing = state[REGISTRATION_KEY];
	const processState = isProcessState(existing)
		? existing
		: await replaceLegacyState(existing);
	state[REGISTRATION_KEY] = processState;
	if (!processState.boundApis.has(pi)) {
		processState.boundApis.add(pi);
		registerCodeModeEvents(pi, processState.runtime);
		registerPublicCodeModeTools(pi, processState.runtime);
	}
	return processState.runtime;
}

function isProcessState(value: unknown): value is CodeModeProcessState {
	return Boolean(
		value &&
		typeof value === "object" &&
		"runtime" in value &&
		isSharedRuntime(value.runtime) &&
		"boundApis" in value &&
		value.boundApis instanceof WeakSet,
	);
}

async function replaceLegacyState(
	legacy: unknown,
): Promise<CodeModeProcessState> {
	// 2.2.0 stored the runtime directly and retained stale providers across reloads.
	if (isSharedRuntime(legacy)) await legacy.shutdownHost();
	return { runtime: new SharedCodeModeRuntime(), boundApis: new WeakSet() };
}

function isSharedRuntime(value: unknown): value is SharedCodeModeRuntime {
	return Boolean(
		value &&
		typeof value === "object" &&
		"providers" in value &&
		value.providers instanceof Map &&
		"shutdownHost" in value &&
		typeof value.shutdownHost === "function",
	);
}

function customToolsDocumentationPath(): string {
	const modulePath = fileURLToPath(import.meta.url);
	const packageRoot = dirname(dirname(dirname(dirname(modulePath))));
	return join(packageRoot, "src", "tools", "code-mode", "CUSTOM-TOOLS.md");
}
