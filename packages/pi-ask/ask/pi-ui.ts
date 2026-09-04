import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OTHER_OPTION_LABEL } from "./constants.js";
import type { AskPrompt, AskResponse } from "./contracts.js";
import { customSelectionFor } from "./state.js";

function dialogOptions(
	signal?: AbortSignal,
): { signal: AbortSignal } | undefined {
	return signal ? { signal } : undefined;
}

async function askOther(
	ctx: ExtensionContext,
	prompt: AskPrompt,
	signal?: AbortSignal,
): Promise<string | null> {
	const value = await ctx.ui.input(
		prompt.title,
		"Alternative; blank = rephrase",
		dialogOptions(signal),
	);
	return value === undefined ? null : customSelectionFor(value);
}

function promptText(
	prompt: AskPrompt,
	handoff: boolean,
	steering: boolean,
): string {
	const text = prompt.body ? `${prompt.title}\n\n${prompt.body}` : prompt.title;
	if (handoff) return `Human action needed\n\n${text}`;
	return steering ? `Agent continues while you decide\n\n${text}` : text;
}

async function askComment(
	ctx: ExtensionContext,
	prompt: AskPrompt,
	signal?: AbortSignal,
): Promise<string | null> {
	const value = await ctx.ui.input(
		`${prompt.title} — comment`,
		"Optional comment",
		dialogOptions(signal),
	);
	return value === undefined ? null : value.trim();
}

function finishSelectionLabelFor(choices: string[]): string {
	const base = "Finish selection";
	const unavailable = new Set([...choices, OTHER_OPTION_LABEL]);
	let label = base;
	let suffix = 2;
	while (unavailable.has(label)) {
		label = `${base} (${suffix})`;
		suffix++;
	}
	return label;
}

async function askSingleWithPiUi(
	ctx: ExtensionContext,
	prompt: AskPrompt,
	handoff: boolean,
	steering: boolean,
	signal?: AbortSignal,
): Promise<string[] | null> {
	const choices = prompt.choices.map((choice) => choice.label);
	const picked =
		choices.length > 0
			? await ctx.ui.select(
					promptText(prompt, handoff, steering),
					[...choices, OTHER_OPTION_LABEL],
					dialogOptions(signal),
				)
			: await ctx.ui.input(
					promptText(prompt, handoff, steering),
					"Response",
					dialogOptions(signal),
				);
	if (picked === undefined) return null;
	if (choices.length === 0) return [customSelectionFor(picked)];
	if (picked !== OTHER_OPTION_LABEL) return [picked];
	const other = await askOther(ctx, prompt, signal);
	return other === null ? null : [other];
}

async function askMultipleWithPiUi(
	ctx: ExtensionContext,
	prompt: AskPrompt,
	handoff: boolean,
	steering: boolean,
	signal?: AbortSignal,
): Promise<string[] | null> {
	const choices = prompt.choices.map((choice) => choice.label);
	const finishSelectionLabel = finishSelectionLabelFor(choices);
	const picked: string[] = [];
	while (true) {
		const next = await ctx.ui.select(
			promptText(prompt, handoff, steering),
			[
				...choices.filter((choice) => !picked.includes(choice)),
				OTHER_OPTION_LABEL,
				finishSelectionLabel,
			],
			dialogOptions(signal),
		);
		if (next === undefined) return null;
		if (next === finishSelectionLabel) return picked;
		if (next === OTHER_OPTION_LABEL) {
			const other = await askOther(ctx, prompt, signal);
			if (other === null) return null;
			picked.push(other);
		} else {
			picked.push(next);
		}
	}
}

export async function askWithPiUi(
	ctx: ExtensionContext,
	prompts: AskPrompt[],
	{
		handoff = false,
		steering = false,
		signal,
	}: { handoff?: boolean; steering?: boolean; signal?: AbortSignal } = {},
): Promise<AskResponse[] | null> {
	if (!ctx.hasUI || signal?.aborted) return null;
	const responses: AskResponse[] = [];
	for (const prompt of prompts) {
		const selections = prompt.multiple
			? await askMultipleWithPiUi(ctx, prompt, handoff, steering, signal)
			: await askSingleWithPiUi(ctx, prompt, handoff, steering, signal);
		if (!selections) return null;
		const comment = await askComment(ctx, prompt, signal);
		if (comment === null || signal?.aborted) return null;
		responses.push({
			id: prompt.id,
			selections,
			...(comment ? { comment } : {}),
		});
	}
	return responses;
}
