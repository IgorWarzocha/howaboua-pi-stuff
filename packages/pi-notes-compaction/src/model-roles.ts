import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { NotesLifecycle } from "./lifecycle.js";
import {
	type RoleConfig,
	readRoleConfig,
	roleConfigPath,
} from "./model-role-config.js";
import { openModelRoleScreen } from "./model-role-screen.js";
import { modelIsActive } from "./settings.js";
import { windowDetails } from "./windows.js";

const GUIDANCE_TYPE = "notes-compaction:roles";

export interface ModelRoleHandoff {
	id: string;
	activate(ctx: ExtensionContext): Promise<void>;
}

export function createModelRoles(
	pi: ExtensionAPI,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
) {
	let config: RoleConfig = { roles: [] };
	let configError: string | undefined;
	const load = () => {
		try {
			config = readRoleConfig();
			configError = undefined;
		} catch (error) {
			config = { roles: [] };
			configError = error instanceof Error ? error.message : String(error);
		}
	};
	pi.on("before_agent_start", (event, ctx) => {
		activation.refreshActivation(ctx);
		if (!lifecycle.active) return;
		const previousError = configError;
		load();
		if (configError && configError !== previousError)
			ctx.ui.notify(`Model roles unavailable: ${configError}`, "error");
		const startingWindow =
			event.messageType === "custom"
				? windowDetails({ ...event.message, type: "custom_message" })
				: undefined;
		const previous = lifecycle.windows
			.projectBranch(ctx.sessionManager.buildContextEntries())
			.findLast(
				(entry) =>
					entry.type === "custom_message" && entry.customType === GUIDANCE_TYPE,
			);
		if (!config.roles.length && !previous) return;
		const content = config.roles.length
			? [
					lifecycle.gptPromptMode()
						? 'Roles=user preferences, not capability limits. Switch only for clear, sustained task/scope change, not one specialised prompt. Any model can do general work. Bounded specialist detour→consider available subagent. Save notes→new_context({role: "name"}); omit role→keep model.'
						: 'Roles are user preferences, not capability limits. Switch only for a clear, sustained change of task or scope, not a single specialised prompt. Any model can do general work. Consider an available subagent for a bounded specialist detour. Save notes, then call new_context({role: "name"}); omit role to keep the current model.',
					...config.roles.map((role) => `- ${role.id}: ${role.description}`),
				].join("\n")
			: "No model roles are available. Call new_context without role.";
		if (
			startingWindow?.kind !== "window" &&
			previous?.type === "custom_message" &&
			previous.content === content
		)
			return;
		const message: CustomMessageEntryDraft = {
			type: "custom_message",
			customType: GUIDANCE_TYPE,
			content,
			display: false,
			details: {},
		};
		return { message: lifecycle.prepareReminder?.(message) ?? message };
	});
	pi.on("context", (event, ctx) => {
		if (
			!lifecycle.active ||
			event.messages.some(
				(message) =>
					message.role === "custom" && message.customType === GUIDANCE_TYPE,
			)
		)
			return;
		const summary = event.messages.findIndex(
			(message) => message.role === "compactionSummary",
		);
		if (summary < 0) return;
		const previous = ctx.sessionManager
			.getBranch()
			.findLast(
				(entry) =>
					entry.type === "custom_message" && entry.customType === GUIDANCE_TYPE,
			);
		if (previous?.type !== "custom_message") return;
		// In-run compaction has no new kickoff. Restore the owned entry before its summary.
		return {
			messages: [
				...event.messages.slice(0, summary),
				{
					role: "custom" as const,
					customType: previous.customType,
					content: previous.content,
					display: false,
					details: previous.details,
					timestamp: Date.parse(previous.timestamp),
				},
				...event.messages.slice(summary),
			],
		};
	});

	async function prepare(
		id: string,
		ctx: ExtensionContext,
	): Promise<ModelRoleHandoff> {
		load();
		if (configError)
			throw new Error(
				"Model roles are unavailable. Continue here and ask the user to check /roles.",
			);
		const role = config.roles.find((candidate) => candidate.id === id);
		if (!role)
			throw new Error(
				`Unknown role ${JSON.stringify(id)}. Use a configured role or omit role to keep the current model.`,
			);
		const model = ctx.modelRegistry.find(role.provider, role.model);
		if (!model)
			throw new Error(
				`Role ${id} is unavailable. Continue here and ask the user to check its model in /roles.`,
			);
		if (!lifecycle.active || !modelIsActive(activation.settings, model))
			throw new Error(
				`Notes must be active for this session and role ${id}. Ask the user to check /notes before switching.`,
			);
		const session = ctx.sessionManager.getSessionId();
		const source = ctx.model;
		const reasoning = pi.getThinkingLevel();
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok)
			throw new Error(
				`Role ${id} has no usable provider access. Continue here and ask the user to check its login or API configuration.`,
			);
		return {
			id,
			async activate(current) {
				if (
					current.sessionManager.getSessionId() !== session ||
					current.model?.provider !== source?.provider ||
					current.model?.id !== source?.id ||
					pi.getThinkingLevel() !== reasoning ||
					!lifecycle.active ||
					!modelIsActive(activation.settings, model)
				)
					throw new Error(
						"The session or model settings changed. Continue here and request a new role handoff if still needed.",
					);
				if (source?.provider !== model.provider || source?.id !== model.id) {
					if (!(await pi.setModel(model)))
						throw new Error(
							`Could not start role ${id}. Check provider access in /roles and retry.`,
						);
				}
				pi.setThinkingLevel(role.reasoning);
			},
		};
	}

	async function command(args: string, ctx: ExtensionCommandContext) {
		if (args.trim()) {
			ctx.ui.notify(
				"Use /roles to view roles and JSON configuration guidance.",
				"info",
			);
			return;
		}
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`Configure model roles in ${roleConfigPath()}. Open /roles in interactive Pi for guidance.`,
				"info",
			);
			return;
		}
		load();
		return (await openModelRoleScreen(
			ctx,
			config.roles,
			roleConfigPath(),
			configError,
		)) === "notes-tab"
			? ("notes" as const)
			: undefined;
	}
	return { prepare, command };
}
