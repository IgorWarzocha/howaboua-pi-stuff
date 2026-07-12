import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverDynamicTools, getDynamicToolsDir } from "./config.js";
import { registerPublicCodeModeTools } from "./public-tools.js";
import {
	SharedCodeModeRuntime,
	type CodeModeToolProvider,
} from "./shared-runtime.js";
import { registerCodeModeEvents } from "./tool-events.js";

// Pi event handlers cannot be unregistered. Keep one process-lifetime runtime
// on pi.events so extension re-registration reuses listeners instead of stacking them.
const REGISTRATION_KEY = Symbol.for("@howaboua/pi-codex-conversion.code-mode");

export interface RegisterCodeModeToolsOptions extends CodeModeToolProvider {}

export interface CodeModeRegistration {
	shutdownHost(): Promise<void>;
	shutdown(): Promise<void>;
}

export async function registerDynamicTools(
	pi: ExtensionAPI,
	toolsDir: string = getDynamicToolsDir(),
	options: { isActive?(ctx: unknown): boolean } = {},
): Promise<CodeModeRegistration> {
	return registerCodeModeTools(pi, {
		getTools: () => discoverDynamicTools(toolsDir),
		documentationPath: dynamicToolsDocumentationPath(),
		...options,
	});
}

export async function registerCodeModeTools(
	pi: ExtensionAPI,
	options: RegisterCodeModeToolsOptions,
): Promise<CodeModeRegistration> {
	const runtime = getOrCreateRuntime(pi);
	const providerId = runtime.addProvider(options);
	let active = true;
	return {
		shutdownHost: () => runtime.shutdownHost(),
		async shutdown() {
			if (!active) return;
			active = false;
			runtime.removeProvider(providerId);
			if (runtime.providers.size === 0) await runtime.shutdownHost();
		},
	};
}

function getOrCreateRuntime(pi: ExtensionAPI): SharedCodeModeRuntime {
	const state = pi.events as typeof pi.events & {
		[REGISTRATION_KEY]?: SharedCodeModeRuntime;
	};
	const existing = state[REGISTRATION_KEY];
	if (existing) return existing;
	const runtime = new SharedCodeModeRuntime();
	state[REGISTRATION_KEY] = runtime;
	registerCodeModeEvents(pi, runtime);
	registerPublicCodeModeTools(pi, runtime);
	return runtime;
}

function dynamicToolsDocumentationPath(): string {
	const modulePath = fileURLToPath(import.meta.url);
	const packageRoot = dirname(dirname(dirname(dirname(modulePath))));
	return join(packageRoot, "src", "tools", "code-mode", "DYNAMIC-TOOLS.md");
}
