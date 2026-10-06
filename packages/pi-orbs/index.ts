import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ZodError } from "zod";
import { HELP } from "./src/contracts.ts";

export default async function orbs(pi: ExtensionAPI): Promise<void> {
	const tool = {
		name: "orbs",
		label: "Orbs",
		description:
			"Local persistent environments and app portals. Send help for actions",
		parameters: Type.Object({ input: Type.String() }),
		async execute(
			_id: string,
			{ input }: { input: string },
			signal: AbortSignal | undefined,
			_update: unknown,
			ctx: { cwd: string },
		) {
			let result: unknown;
			if (input.trim() === "help") result = HELP;
			else {
				let action: unknown;
				try {
					action = JSON.parse(input);
				} catch {
					throw new Error("Send help or a JSON action object");
				}
				const { run } = await import("./src/client.ts");
				try {
					result = await run(action, ctx.cwd, signal);
				} catch (error) {
					if (error instanceof ZodError)
						throw new Error(
							`${error.issues
								.slice(0, 3)
								.map(
									(issue) =>
										`${issue.path.join(".") || "input"}: ${issue.message}`,
								)
								.join("; ")}. Send help for valid arguments`,
						);
					throw error;
				}
			}
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result) }],
				details: {},
			};
		},
	};
	pi.registerTool(tool);
	pi.registerCommand("orbs", {
		description: "Guest terminal handoff: /orbs <name> [user]",
		handler: async (args, ctx) => {
			const [name, user = "root", extra] = args.trim().split(/\s+/);
			if (!name || extra) {
				ctx.ui.notify(
					"Usage: /orbs <name> [user]. Ask the agent to create or start an environment first",
					"info",
				);
				return;
			}
			try {
				const { run } = await import("./src/client.ts");
				const result = await run({ action: "shell", name, user }, ctx.cwd);
				ctx.ui.notify(JSON.stringify(result), "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : "Guest terminal unavailable",
					"error",
				);
			}
		},
	});
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(pi, () => [
			adaptToolForCodeMode(tool, {
				usage: 'await tools.orbs("help")',
				kind: "freeform",
				prepareInput: (input) => {
					if (typeof input !== "string")
						throw new Error("Send help or JSON text to orbs");
					return { input };
				},
				resultValue: (result) => {
					const content = result.content.find((item) => item.type === "text");
					if (!content) throw new Error("Orb response has no text");
					return JSON.parse(content.text);
				},
				deferLoading: true,
			}),
		]);
		pi.on("session_shutdown", () => registration.unregister());
	} catch (error) {
		const missing =
			error instanceof Error
				? error.message
						.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/)?.[1]
						?.replaceAll("\\", "/")
						.replace(/\.[jt]s$/, "")
				: undefined;
		if (
			error instanceof Error &&
			"code" in error &&
			(error.code === "ERR_MODULE_NOT_FOUND" ||
				error.code === "MODULE_NOT_FOUND") &&
			(missing === "@howaboua/pi-codex-conversion" ||
				missing === "@howaboua/pi-codex-conversion/code-mode" ||
				missing?.endsWith("/@howaboua/pi-codex-conversion/code-mode"))
		)
			return;
		throw error;
	}
}
