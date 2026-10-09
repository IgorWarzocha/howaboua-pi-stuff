import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readExtensionCommands } from "./command-config.js";

const builtins = {
	quit: "Shut down Pi and close its pane",
	model: "Set model: /model provider/model-id",
	thinking: "Set thinking: /thinking off|minimal|low|medium|high|xhigh",
	name: "Set session name: /name name",
	new: "Start a new session",
	reload: "Reload extensions and resources",
	resume: "Resume a session: /resume session-path",
	compact: "Compact context: /compact [instructions]",
};

export function createPeerCommands(pi: ExtensionAPI) {
	const pending = new Map<
		string,
		{
			session: string | undefined;
			run: (ctx: ExtensionCommandContext) => Promise<void>;
		}
	>();
	pi.on("session_shutdown", () => pending.clear());
	const available = (configured?: Record<string, string>) => {
		let allowed: Record<string, string>;
		try {
			allowed = configured ?? readExtensionCommands();
		} catch {
			throw new Error(
				"Command permissions could not be read; built-in commands remain available. Ask the user to check Shepherdr's Agent commands settings",
			);
		}
		return Object.entries(builtins)
			.map(([name, description]) => ({ name, description }))
			.concat(
				pi.getCommands().flatMap((entry) => {
					const description = allowed[entry.name];
					return entry.source === "extension" &&
						Object.hasOwn(allowed, entry.name) &&
						description !== undefined &&
						!Object.hasOwn(builtins, entry.name)
						? [{ name: entry.name, description }]
						: [];
				}),
			);
	};
	return {
		available,
		async handle(args: string, ctx: ExtensionCommandContext): Promise<boolean> {
			const intent = pending.get(args);
			if (!intent) return false;
			pending.delete(args);
			if (ctx.sessionManager.getSessionFile() !== intent.session)
				throw new Error("Target session changed; resolve the target again");
			await intent.run(ctx);
			return true;
		},
		prepare(
			text: string,
			ctx: ExtensionContext,
		): { command: boolean; submit: () => void } {
			const space = text.indexOf(" ");
			const name = text.slice(1, space < 0 ? undefined : space);
			const args = space < 0 ? "" : text.slice(space + 1).trim();
			if (Object.hasOwn(builtins, name)) {
				if (name !== "quit" && !ctx.isIdle())
					throw new Error("Target is busy; retry after it settles");
				const run = prepareBuiltin(pi, name, args, ctx);
				return {
					command: true,
					submit: () => {
						const token = randomUUID();
						pending.set(token, {
							session: ctx.sessionManager.getSessionFile(),
							run,
						});
						pi.sendUserMessage(`/herdr ${token}`, {
							expandPromptTemplates: true,
						});
					},
				};
			}
			const commands = pi.getCommands();
			const entry = commands.find((entry) => entry.name === name);
			let allowed: Record<string, string> = {};
			try {
				allowed = readExtensionCommands();
			} catch (error) {
				ctx.ui.notify(`Extension commands disabled: ${String(error)}`, "error");
			}
			if (
				!entry ||
				(entry.source === "extension" && !Object.hasOwn(allowed, name))
			) {
				throw new Error(
					`Command /${name} is unavailable. Available commands:\n${available(
						allowed,
					)
						.map(({ name, description }) => `/${name}: ${description}`)
						.join("\n")}`,
				);
			}
			return {
				command: entry.source === "extension",
				submit: () =>
					pi.sendUserMessage(text, {
						expandPromptTemplates: true,
						deliverAs: "steer",
					}),
			};
		},
	};
}

function prepareBuiltin(
	pi: ExtensionAPI,
	name: string,
	args: string,
	ctx: ExtensionContext,
): (ctx: ExtensionCommandContext) => Promise<void> {
	if (["quit", "new", "reload"].includes(name) && args)
		throw new Error(`/${name} takes no arguments`);
	switch (name) {
		case "quit":
			return async (ctx) => ctx.shutdown();
		case "new":
			return async (ctx) => {
				if ((await ctx.newSession()).cancelled)
					throw new Error("New session cancelled");
			};
		case "reload":
			return async (ctx) => {
				await ctx.reload();
			};
		case "resume":
			if (!args) throw new Error("Use /resume session-path");
			return async (ctx) => {
				if ((await ctx.switchSession(args)).cancelled)
					throw new Error("Session switch cancelled");
			};
		case "name":
			if (!args) throw new Error("Use /name name");
			return async () => pi.setSessionName(args);
		case "thinking": {
			if (
				args !== "off" &&
				args !== "minimal" &&
				args !== "low" &&
				args !== "medium" &&
				args !== "high" &&
				args !== "xhigh"
			)
				throw new Error(builtins.thinking);
			return async () => pi.setThinkingLevel(args);
		}
		case "model": {
			const model = ctx.modelRegistry
				.getAvailable()
				.find((model) => `${model.provider}/${model.id}` === args);
			if (!model)
				throw new Error(
					`Use /model provider/model-id. Available: ${ctx.modelRegistry
						.getAvailable()
						.map((model) => `${model.provider}/${model.id}`)
						.join(", ")}`,
				);
			return async () => {
				if (!(await pi.setModel(model)))
					throw new Error("Model unavailable; choose another model");
			};
		}
		case "compact":
			return async (ctx) =>
				ctx.compact({
					...(args ? { customInstructions: args } : {}),
					onError: (error) =>
						ctx.ui.notify(`Compaction failed: ${error.message}`, "error"),
				});
		default:
			throw new Error(`Unsupported command /${name}`);
	}
}
