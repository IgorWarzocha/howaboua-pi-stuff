import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type ExtensionAPI,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import registerPackageChangelog from "../changelog.js";

const ventSchema = Type.Object(
	{
		thought: Type.String({
			description: "Vent entry text.",
		}),
		trigger: Type.Optional(
			Type.String({ description: "Optional short trigger label." }),
		),
	},
	{ additionalProperties: false },
);

function clean(input: string): string {
	return input.trim().replace(/\r\n/g, "\n");
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf8");
		return true;
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export default function ventExtension(pi: ExtensionAPI) {
	registerPackageChangelog(pi);
	pi.registerTool({
		name: "vent",
		label: "vent",
		description: "Append workflow-friction feedback to VENT.md.",
		promptSnippet: "Log repeated workflow friction.",
		promptGuidelines: [
			"vent: Use for repeated or systemic workflow friction, especially when the same manual workaround happens more than once.",
			"vent: Use after a second hook/tool failure with the same root cause, or when tool output forces the same retry sequence.",
			"vent: Use when project instructions, docs, or tooling cause avoidable backtracking that should become automation, docs, or workflow fixes.",
			"vent: Do not use for one-off lint/type errors or ordinary coding mistakes.",
			"vent: Call near the end of the turn after completing the task; batch related feedback instead of calling repeatedly.",
			"vent: Include what failed, what workaround was repeated, and what would prevent it next time; never use vent as a substitute for finishing the task.",
		],
		parameters: ventSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const thought = clean(params.thought);
			if (!thought) throw new Error("vent.thought must not be empty");

			const trigger = params.trigger ? clean(params.trigger) : undefined;
			const ventPath = resolve(ctx.cwd, "VENT.md");
			const now = new Date();
			const timestamp =
				[
					String(now.getFullYear()).slice(-2),
					String(now.getMonth() + 1).padStart(2, "0"),
					String(now.getDate()).padStart(2, "0"),
				].join("-") +
				" " +
				[
					String(now.getHours()).padStart(2, "0"),
					String(now.getMinutes()).padStart(2, "0"),
				].join(":");
			const heading =
				"# VENT\n\nFeedback log. Repeated/systemic workflow friction that should become future automation, docs, or workflow fixes.\n\n";
			const entry = [
				`## ${timestamp}${trigger ? ` — ${trigger}` : ""}`,
				"",
				thought,
				"",
			].join("\n");

			return withFileMutationQueue(ventPath, async () => {
				if (!(await fileExists(ventPath))) {
					await writeFile(ventPath, heading, "utf8");
				}
				await appendFile(ventPath, entry, "utf8");

				return {
					content: [
						{
							type: "text" as const,
							text: `Appended vent entry to VENT.md (${timestamp}).`,
						},
					],
					details: { path: "VENT.md", timestamp, trigger, thought },
				};
			});
		},

		renderCall(args, theme, _context) {
			const trigger =
				typeof args?.trigger === "string" && args.trigger.trim()
					? ` ${args.trigger.trim()}`
					: "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("vent"))}${theme.fg("muted", trigger)}`,
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as
				| { timestamp?: unknown; thought?: unknown }
				| undefined;
			const timestamp =
				typeof details?.timestamp === "string" ? details.timestamp : "saved";
			let text = `${theme.fg("success", "✓")} wrote ${theme.fg("accent", "VENT.md")} ${theme.fg("dim", timestamp)}`;

			if (expanded && typeof details?.thought === "string") {
				text += `\n\n${details.thought}`;
			}

			return new Text(text, 0, 0);
		},
	});
}
