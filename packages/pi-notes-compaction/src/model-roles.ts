import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { NotesLifecycle } from "./lifecycle.js";
import {
	type ModelRole,
	type RoleConfig,
	readRoleConfig,
	writeRoleConfig,
} from "./model-role-config.js";
import { editModelRole } from "./model-role-editor.js";
import { openModelRoleScreen } from "./model-role-screen.js";
import { modelIsActive } from "./settings.js";

export function createModelRoles(
	pi: ExtensionAPI,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
	refresh: () => void,
) {
	let config: RoleConfig = { enabled: false, roles: [] };
	let configError: string | undefined;
	try {
		config = readRoleConfig();
	} catch (error) {
		configError = String(error);
	}
	type Recommendation = {
		role: ModelRole;
		reason: string;
		continuity: string;
		session: string;
		provider: string | undefined;
		model: string | undefined;
		reasoning: string;
		settled: boolean;
	};
	let pending: Recommendation | undefined;
	let selectedRole: string | undefined;
	let completed = false;
	let generation = 0;
	const enabled = () => lifecycle.active && config.enabled;
	const reset = () => {
		generation++;
		pending = undefined;
		completed = false;
	};
	const save = (value: RoleConfig) => {
		writeRoleConfig(value);
		config = value;
		selectedRole = undefined;
		configError = undefined;
		reset();
		refresh();
		pi.sendMessage(
			{
				customType: "model-role-update",
				display: false,
				content: config.enabled
					? "Role preferences updated. Discover current preferences with notes action=roles before recommending a handoff"
					: "Role recommendations disabled. Keep the current model unless the user directs a switch",
			},
			{ deliverAs: "nextTurn" },
		);
	};
	const query = async (
		args: { role?: string; reason?: string; continuity?: string },
		ctx: ExtensionContext,
	) => {
		if (!enabled())
			throw new Error(
				"Role recommendations are off. The user can enable them with /roles",
			);
		let result: unknown;
		if (!args.role) {
			if (args.reason || args.continuity)
				throw new Error(
					"Supply role, reason and continuity together, or use notes action=roles to discover preferences",
				);
			result = {
				current: {
					provider: ctx.model?.provider,
					model: ctx.model?.id,
					reasoning: pi.getThinkingLevel(),
					selectedRole: selectedRole ?? null,
					matchingRoles: config.roles
						.filter(
							(role) =>
								role.provider === ctx.model?.provider &&
								role.model === ctx.model?.id,
						)
						.map((role) => role.id),
				},
				roles: config.roles,
				pending,
			};
		} else {
			const role = config.roles.find((role) => role.id === args.role);
			if (!role)
				throw new Error(
					"Unknown role. Use notes action=roles for configured roles",
				);
			if (!args.reason?.trim() || !args.continuity?.trim())
				throw new Error("A recommendation needs reason and continuity");
			if (
				selectedRole === role.id &&
				role.provider === ctx.model?.provider &&
				role.model === ctx.model.id
			)
				throw new Error(
					"Already using this role's model and reasoning; continue here",
				);
			pending = {
				role: { ...role },
				reason: args.reason.trim(),
				continuity: args.continuity.trim(),
				session: ctx.sessionManager.getSessionId(),
				provider: ctx.model?.provider,
				model: ctx.model?.id,
				reasoning: pi.getThinkingLevel(),
				settled: false,
			};
			result = {
				recommendation: role.id,
				reason: pending.reason,
				continuity: pending.continuity,
				status:
					"Awaiting run settlement and user action: /roles accept. Continue here unless accepted",
			};
		}
		return {
			content: [{ type: "text" as const, text: JSON.stringify(result) }],
			details: {},
		};
	};
	pi.on("before_agent_start", (_event, ctx) => {
		activation.refreshActivation(ctx);
		refresh();
		reset();
		if (!enabled()) return;
		const content =
			"Model role preferences are enabled. Discover current model and configured preferences with notes action=roles. Use notes action=recommend_handoff with role, evidence in reason, and continuity when accumulated conversation favours a different role, never after fixed turns. Keep the current model until the user accepts.";
		const present = ctx.sessionManager
			.buildContextEntries()
			.some(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "custom" &&
					entry.message.customType === "model-role-guidance" &&
					entry.message.content === content,
			);
		if (!present)
			return {
				message: { customType: "model-role-guidance", content, display: false },
			};
	});
	pi.on("model_select", () => {
		reset();
		selectedRole = undefined;
	});
	pi.on("thinking_level_select", () => {
		reset();
		selectedRole = undefined;
	});
	const navigation = () => {
		selectedRole = undefined;
		reset();
	};
	pi.on("session_before_switch", navigation);
	pi.on("session_before_fork", navigation);
	pi.on("session_before_tree", navigation);
	pi.on("session_tree", reset);
	pi.on("agent_before_settle", (event) => {
		completed = event.outcome === "completed";
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (!pending) {
			completed = false;
			return;
		}
		if (!enabled() || pending.settled || _event.aborted || !completed) {
			reset();
			return;
		}
		pending.settled = true;
		ctx.ui.notify(
			`Recommended role: ${pending.role.id} (${pending.role.provider}/${pending.role.model})\n${pending.reason}\n/roles accept to switch in this conversation; /roles dismiss to keep the current model`,
			"info",
		);
	});
	pi.on("session_start", (_event, ctx) => {
		reset();
		selectedRole = undefined;
		if (configError)
			ctx.ui.notify(`Role recommendations are off: ${configError}`, "error");
	});

	async function switchRole(
		role: ModelRole,
		ctx: ExtensionCommandContext,
		recommendation?: Recommendation,
	) {
		const session = ctx.sessionManager.getSessionId();
		const provider = ctx.model?.provider;
		const modelId = ctx.model?.id;
		const reasoning = pi.getThinkingLevel();
		const version = generation;
		await ctx.waitForIdle();
		if (
			!ctx.isIdle() ||
			generation !== version ||
			ctx.sessionManager.getSessionId() !== session ||
			ctx.model?.provider !== provider ||
			ctx.model?.id !== modelId ||
			pi.getThinkingLevel() !== reasoning ||
			(recommendation &&
				(pending !== recommendation ||
					!recommendation.settled ||
					recommendation.session !== session ||
					recommendation.provider !== provider ||
					recommendation.model !== modelId ||
					recommendation.reasoning !== reasoning))
		) {
			ctx.ui.notify(
				"The conversation or model changed. Keep the current model; request a new recommendation or choose a role with /roles",
				"warning",
			);
			return;
		}
		const model = ctx.modelRegistry.find(role.provider, role.model);
		if (!model)
			throw new Error(
				`Model unavailable: ${role.provider}/${role.model}. Choose another model with /roles`,
			);
		if (!lifecycle.active || !modelIsActive(activation.settings, model))
			throw new Error(
				"Notes must be active for both models. Check Active and model whitelist in /notes before switching",
			);
		// Use Pi's existing session and replay projection; never recreate messages or tool pairs.
		if (provider !== model.provider || modelId !== model.id) {
			if (!(await pi.setModel(model)))
				throw new Error(
					`Could not select ${role.provider}/${role.model}; check provider authentication or choose another role with /roles`,
				);
		}
		pi.setThinkingLevel(role.reasoning);
		selectedRole = role.id;
		reset();
		pi.sendMessage(
			{
				customType: "model-role-handoff",
				display: true,
				content: `Using role ${role.id}: ${role.description}\nModel: ${role.provider}/${role.model}; reasoning: ${pi.getThinkingLevel()}. Conversation retained.${recommendation ? `\nReason: ${recommendation.reason}\nContinuity: ${recommendation.continuity}` : ""}`,
			},
			{ deliverAs: "nextTurn" },
		);
		ctx.ui.notify(
			`Using ${role.id}: ${role.provider}/${role.model} (${pi.getThinkingLevel()}). Conversation retained`,
			"info",
		);
	}

	const command = async (args: string, ctx: ExtensionCommandContext) => {
		try {
			const input = args.trim();
			if (input === "dismiss") {
				reset();
				ctx.ui.notify(
					"Recommendation dismissed; current model retained",
					"info",
				);
				return;
			}
			if (input === "accept") {
				if (!pending) {
					ctx.ui.notify(
						"No current recommendation. Use /roles to choose a role",
						"info",
					);
					return;
				}
				await switchRole(pending.role, ctx, pending);
				return;
			}
			if (input) {
				ctx.ui.notify("Usage: /roles [accept|dismiss]", "error");
				return;
			}
			if (!ctx.hasUI)
				throw new Error(
					"Role configuration needs interactive Pi. /roles accept and /roles dismiss remain available",
				);
			while (true) {
				const choice = await openModelRoleScreen(
					ctx,
					[
						...(pending
							? ["Accept recommendation", "Dismiss recommendation"]
							: []),
						"Switch role",
						"Add or replace role",
						"Remove role",
						config.enabled
							? "Disable recommendations"
							: "Enable recommendations",
					],
					config.roles,
				);
				if (!choice) return;
				if (choice === "notes-tab") return "notes" as const;
				if (choice === "Accept recommendation" && pending)
					await switchRole(pending.role, ctx, pending);
				else if (choice === "Dismiss recommendation") reset();
				else if (choice === "Switch role") {
					const id = await ctx.ui.select(
						"Switch role (conversation retained)",
						config.roles.map((role) => role.id),
					);
					const role = config.roles.find((role) => role.id === id);
					if (role) await switchRole(role, ctx);
				} else if (choice === "Add or replace role") {
					const role = await editModelRole(ctx);
					if (role)
						save({
							...config,
							roles: [
								...config.roles.filter((existing) => existing.id !== role.id),
								role,
							],
						});
				} else if (choice === "Remove role") {
					const id = await ctx.ui.select(
						"Remove role",
						config.roles.map((role) => role.id),
					);
					if (!id) return;
					save({
						...config,
						roles: config.roles.filter((role) => role.id !== id),
					});
				} else if (
					choice === "Enable recommendations" ||
					choice === "Disable recommendations"
				) {
					save({ ...config, enabled: choice === "Enable recommendations" });
				}
			}
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	};
	return {
		enabled,
		command,
		query,
	};
}
