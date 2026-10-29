import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type ModelRole,
	THINKING_LEVELS,
	type ThinkingLevel,
} from "./model-role-config.js";

export async function editModelRole(
	ctx: ExtensionCommandContext,
): Promise<ModelRole | undefined> {
	const id = (
		await ctx.ui.input("Role ID", "Lowercase letters, numbers and hyphens")
	)?.trim();
	if (!id) return;
	if (!/^[a-z][a-z0-9-]*$/.test(id))
		throw new Error(
			"Role IDs must start with a lowercase letter and contain only lowercase letters, numbers and hyphens",
		);
	const description = (
		await ctx.ui.input("When should this role be preferred?")
	)?.trim();
	if (!description) return;
	const models = ctx.modelRegistry.getAvailable();
	const labels = models.map((model) => `${model.provider}/${model.id}`);
	const selected = await ctx.ui.select("Role model", labels);
	const model = models[labels.indexOf(selected ?? "")];
	if (!model) return;
	const reasoning = await ctx.ui.select(
		"Preferred reasoning (Pi clamps unsupported levels)",
		[...THINKING_LEVELS],
	);
	if (!reasoning) return;
	return {
		id,
		description,
		provider: model.provider,
		model: model.id,
		reasoning: reasoning as ThinkingLevel,
	};
}
