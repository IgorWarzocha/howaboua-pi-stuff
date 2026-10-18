import { readFile } from "node:fs/promises";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export async function registerPulseControls(
	pi: ExtensionAPI,
	operations: {
		help(ctx: ExtensionContext): Promise<string>;
		run(ctx: ExtensionContext, id: string): Promise<string>;
	},
) {
	const tool = defineTool({
		name: "pulses",
		label: "Pulses",
		description: "Run a saved routine",
		parameters: Type.Object(
			{
				run: Type.Optional(Type.String({ minLength: 1 })),
				skill: Type.Optional(Type.Literal(true)),
			},
			{ additionalProperties: false },
		),
		async execute(_id, args, _signal, _update, ctx) {
			if (args.run !== undefined && args.skill !== undefined)
				throw new Error("Supply run or skill, not both.");
			const text = args.skill
				? await readFile(
						new URL("../skills/pulses/SKILL.md", import.meta.url),
						"utf8",
					)
				: args.run !== undefined
					? await operations.run(ctx, args.run)
					: await operations.help(ctx);
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	});
	pi.registerTool(tool);
	pi.registerCommand("pulses", {
		description: "Show saved routines, or run one with /pulses <name>",
		handler: async (args, ctx) => {
			try {
				ctx.ui.notify(
					args.trim()
						? await operations.run(ctx, args.trim())
						: await operations.help(ctx),
					"info",
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error
						? error.message
						: "Pulses could not complete this request.",
					"warning",
				);
			}
		},
	});
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				discovery: "help",
				deferLoading: true,
			}),
		]);
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			!["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(
				String(error.code),
			) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
}
