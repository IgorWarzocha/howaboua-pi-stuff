import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadAskConfig } from "./ask/config.js";
import { isSteeringAskInput } from "./ask/normalize.js";
import { PENDING_ASK_ENTRY_TYPE, readPendingAsks } from "./ask/pending.js";
import { createAskRuntime, createAskTool } from "./ask/tool.js";
import registerPackageChangelog from "./changelog.js";

export { createAskTool } from "./ask/tool.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
const CODE_MODE_PACKAGE = "@howaboua/pi-codex-conversion";
const CODE_MODE_MODULE = `${CODE_MODE_PACKAGE}/code-mode`;

export default async function humanInTheLoop(pi: ExtensionAPI): Promise<void> {
	registerPackageChangelog(pi);
	const askRuntime = createAskRuntime({
		deliverSteer: (message) => {
			pi.sendUserMessage(message, { deliverAs: "steer" });
		},
		onBlockedChange: (state) => {
			pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, {
				id: state.id,
				active: state.active,
				prompt: state.prompt,
			});
			pi.events.emit("herdr:blocked", {
				active: state.active,
				label: state.label,
			});
		},
		onPendingChange: (update) => {
			pi.appendEntry(PENDING_ASK_ENTRY_TYPE, update);
		},
	});
	const ask = askRuntime.tool;
	const restorePending = (ctx: ExtensionContext) => {
		askRuntime.restorePending(
			readPendingAsks(ctx.sessionManager.getBranch()),
			ctx,
		);
	};
	pi.registerTool(ask);
	await registerAskInCodeMode(pi, ask);
	pi.on("session_start", (_event, ctx) => restorePending(ctx));
	pi.on("session_tree", (_event, ctx) => restorePending(ctx));
	pi.on("session_shutdown", () => askRuntime.shutdown());
	pi.on("resources_discover", () => {
		const config = loadAskConfig();
		return {
			promptPaths: [
				...(config.grill ? [join(PROMPTS_DIR, "grill.md")] : []),
				...(config.fold ? [join(PROMPTS_DIR, "fold.md")] : []),
			],
		};
	});
}

async function registerAskInCodeMode(
	pi: ExtensionAPI,
	ask: ReturnType<typeof createAskTool>,
): Promise<void> {
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(ask, {
				blocking: (input) => !isSteeringAskInput(input),
				usage:
					'await tools.ask({ prompts: [{ title, body?, multiple?, choices?: [{ label, description? }] }], delivery?: "wait"|"steer", handoff? })',
			}),
		]);
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (isMissingCodeModeExtension(error)) return;
		if (isOutdatedCodeModeExtension(error)) {
			throw new Error(
				"Update " +
					CODE_MODE_PACKAGE +
					" to 3.0.24 or newer to use Pi Ask with it",
				{ cause: error },
			);
		}
		throw error;
	}
}

function isMissingCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		(error.code !== "ERR_MODULE_NOT_FOUND" &&
			error.code !== "MODULE_NOT_FOUND") ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	const missing = error.message.match(
		/Cannot find (?:package|module) ['"]([^'"]+)['"]/,
	)?.[1];
	return missing === CODE_MODE_PACKAGE || missing === CODE_MODE_MODULE;
}

function isOutdatedCodeModeExtension(error: unknown): boolean {
	if (
		!error ||
		typeof error !== "object" ||
		!("code" in error) ||
		!("message" in error) ||
		typeof error.message !== "string"
	)
		return false;
	return (
		(error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
			error.code === "ERR_UNSUPPORTED_DIR_IMPORT") &&
		(error.message.includes(CODE_MODE_MODULE) ||
			(error.message.includes("Package subpath './code-mode'") &&
				error.message.includes(CODE_MODE_PACKAGE)))
	);
}
