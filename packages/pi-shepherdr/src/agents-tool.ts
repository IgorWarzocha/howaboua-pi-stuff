import { defineTool, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
	AgentsParameters,
	type AgentsParams,
	type AgentsToolParams,
	parseAgentsRequest,
} from "./agents-contract.js";
import {
	agentsHelp,
	allocateAgentName,
	dispatchAgentWork,
	findFleetAgents,
	listFleetAgents,
	readAgentTerminal,
	reportProgress,
	settlementResult,
	toolResult,
} from "./agents-operations.js";
import { type AskAnswer, prepareAskAnswer } from "./ask-answer.js";
import type { AgentFleet } from "./fleet.js";
import { resolvePiAgent } from "./herdr.js";
import { isHerdrResponseError } from "./herdr-client.js";
import {
	resolvePreparationDirectory,
	rollbackStartedAgent,
	startAgent,
} from "./launch.js";
import {
	loadAgentProfiles,
	prepareProfileMessage,
	profileAgentArgs,
} from "./profiles.js";

function required(value: string | undefined, field: string): string {
	if (!value?.trim()) throw new Error(`${field} is required for this action`);
	return value.trim();
}

function agentLabel(value: string | undefined): string {
	const label = required(value, "label");
	const words = label.split(/\s+/u);
	if (words.length < 2 || words.length > 3) {
		throw new Error("label must contain 2 or 3 words");
	}
	return label;
}

export function createAgentsTool(fleet: AgentFleet) {
	return defineTool({
		name: "agents",
		label: "Shepherdr 2",
		description: "Persistent Pi agents across configured Herdr machines.",
		parameters: AgentsParameters,
		promptSnippet: "Load agents help before first use.",
		promptGuidelines: [
			"agents: Blocking is default; set blocking false only while continuing other work. Asynchronous settlement is pushed automatically, so never poll.",
			"agents: Specialists know their job. Give only the concrete task and inaccessible context; never append generic method, evidence, or reporting instructions.",
			"agents: Reuse specialists only for the same investigation. Keep reviews independent. New scope gets a new agent.",
			"agents: For advanced Herdr workspace, pane, process or layout control, run herdr --skill.",
		],
		executionMode: "sequential",
		async execute(
			_toolCallId,
			input: AgentsToolParams,
			signal,
			onUpdate,
			_ctx,
		) {
			const params = parseAgentsRequest(input);
			const executionSignal = signal ?? new AbortController().signal;
			const update = onUpdate ?? (() => undefined);
			if (params.action === "help") {
				return toolResult(await agentsHelp());
			}
			if (params.action === "list") {
				return toolResult(await listFleetAgents(fleet, params));
			}
			if (params.action === "find") {
				return toolResult(await findFleetAgents(fleet, params));
			}

			const runtime = fleet.connected(params.machine);
			if (params.action === "spawn") {
				const profiles = await loadAgentProfiles();
				const profileName = required(params.agent_type, "agent_type");
				const profile = profiles.get(profileName);
				if (!profile) {
					throw new Error(
						`unknown agent_type ${JSON.stringify(profileName)}; available: ${[...profiles.keys()].join(", ")}`,
					);
				}
				const label = agentLabel(params.label);
				const name =
					params.name?.trim() || (await allocateAgentName(runtime, label));
				const placement =
					params.placement ??
					(runtime.local && process.env["HERDR_WORKSPACE_ID"]
						? "new_tab"
						: "new_workspace");
				const workspace =
					params.workspace ??
					(placement === "new_tab" && runtime.local
						? process.env["HERDR_WORKSPACE_ID"]
						: undefined);
				const startParams = {
					name,
					label,
					placement,
					...(workspace ? { workspace } : {}),
					...(params.pane ? { pane: params.pane } : {}),
					...(params.cwd ? { cwd: params.cwd } : {}),
				};
				const cwd = await resolvePreparationDirectory(
					runtime.client,
					startParams,
					runtime.fallbackCwd,
					runtime.resolveDirectory,
				);
				const message = await prepareProfileMessage(
					profile,
					{
						cwd,
						message: required(params.message, "message"),
						...(params.base ? { base: params.base } : {}),
					},
					{ targetLocal: runtime.local },
				);
				reportProgress(update, `Spawning ${label}`, {
					machine: runtime.machine,
					name,
					profile: profile.name,
					status: "starting",
				});
				const started = await startAgent(
					runtime.client,
					runtime.monitor,
					startParams,
					runtime.fallbackCwd,
					runtime.resolveDirectory,
					{
						agentArgs: profileAgentArgs(profile, {
							targetLocal: runtime.local,
						}),
					},
				);
				let promptSubmissionStarted = false;
				let promptAccepted = false;
				let settlement;
				try {
					settlement = await dispatchAgentWork(
						runtime,
						started.agent,
						message,
						params.blocking !== false,
						executionSignal,
						update,
						async () => {
							promptSubmissionStarted = true;
							await runtime.client.request("agent.prompt", {
								target: started.id,
								text: message,
							});
							promptAccepted = true;
						},
						{ expectUserMessage: true },
					);
				} catch (error) {
					if (
						!promptAccepted &&
						(!promptSubmissionStarted || isHerdrResponseError(error))
					) {
						return rollbackStartedAgent(
							runtime.client,
							runtime.monitor,
							started,
							error,
						);
					}
					throw error;
				}
				return toolResult(
					settlement
						? {
								spawned: true,
								...settlementResult(runtime.machine, settlement),
							}
						: {
								spawned: true,
								machine: runtime.machine,
								target: started.id,
								name,
								status: "working",
								next: "Completion or blockage will be delivered automatically; do not poll",
							},
				);
			}

			const target = required(params.target, "target");
			if (params.action === "unwatch") {
				const record = runtime.monitor
					.list()
					.find((agent) => agent.paneId === target || agent.name === target);
				if (!record) {
					return toolResult({
						unwatched: false,
						machine: runtime.machine,
						target,
					});
				}
				await runtime.monitor.unwatch(record.paneId);
				return toolResult({
					unwatched: true,
					machine: runtime.machine,
					target: record.paneId,
				});
			}

			const panel = await resolvePiAgent(
				runtime.client,
				target,
				runtime.local ? process.env["HERDR_PANE_ID"] : "",
			);
			if (params.action === "watch") {
				await runtime.monitor.watch(panel);
				return toolResult({
					watched: true,
					machine: runtime.machine,
					target: panel.pane_id,
					next: "Completion or blockage will be delivered automatically; do not poll",
				});
			}
			if (params.action === "read") {
				const source = params.source ?? "latest";
				if (source !== "latest") {
					return toolResult(
						await readAgentTerminal(runtime, panel, source, params.lines ?? 40),
					);
				}
				const view = await runtime.monitor.view(panel);
				return toolResult({
					machine: runtime.machine,
					target: panel.pane_id,
					status: panel.agent_status,
					...(view.assistant
						? { reply: view.assistant.text }
						: { reply: null }),
					...(panel.agent_status === "blocked" && view.ask
						? {
								ask: {
									handoff: view.ask.handoff,
									prompts: view.ask.prompts,
								},
							}
						: {}),
				});
			}
			if (params.action === "send") {
				if (panel.agent_status === "blocked") {
					const view = await runtime.monitor.view(panel);
					throw new Error(
						`${panel.pane_id} is blocked${view.ask ? " on ask; use action=answer" : ""}`,
					);
				}
				const message = required(params.message, "message");
				if (!runtime.monitor.isMonitored(panel.pane_id)) {
					await runtime.monitor.track(panel);
				}
				const settlement = await dispatchAgentWork(
					runtime,
					panel,
					message,
					params.blocking !== false,
					executionSignal,
					update,
					() =>
						runtime.client.request("agent.prompt", {
							target: panel.pane_id,
							text: message,
						}),
					{ expectUserMessage: true },
				);
				return toolResult(
					settlement
						? { sent: true, ...settlementResult(runtime.machine, settlement) }
						: {
								sent: true,
								machine: runtime.machine,
								target: panel.pane_id,
								status: "working",
								next: "Completion or blockage will be delivered automatically; do not poll",
							},
				);
			}
			if (params.action === "answer") {
				if (!runtime.monitor.isMonitored(panel.pane_id)) {
					await runtime.monitor.track(panel);
				}
				const prepared = await prepareAskAnswer(
					runtime.client,
					runtime.monitor,
					panel,
					(params.answers ?? []) as AskAnswer[],
					executionSignal,
				);
				const task = `Answer: ${prepared.ask.prompts
					.map((prompt) => prompt.title)
					.join(", ")}`;
				const settlement = await dispatchAgentWork(
					runtime,
					panel,
					task,
					params.blocking !== false,
					executionSignal,
					update,
					prepared.submit,
				);
				return toolResult(
					settlement
						? {
								answered: true,
								...settlementResult(runtime.machine, settlement),
							}
						: {
								answered: true,
								machine: runtime.machine,
								target: panel.pane_id,
								status: "working",
								next: "Completion or blockage will be delivered automatically; do not poll",
							},
				);
			}
			throw new Error(`unsupported action ${params.action}`);
		},
		renderCall(args, theme, context) {
			let params: AgentsParams | undefined;
			try {
				params = parseAgentsRequest(args);
			} catch {
				params = undefined;
			}
			const identity =
				params?.target ??
				params?.label ??
				params?.name ??
				params?.agent_type ??
				"";
			return new Text(
				theme.fg(
					context && "isBlocked" in context && context.isBlocked === true
						? "warning"
						: "toolTitle",
					theme.bold(`agents ${params?.action ?? "request"}`),
				) + (identity ? theme.fg("muted", ` · ${identity}`) : ""),
				0,
				0,
			);
		},
		renderResult(toolResult, options, theme) {
			const details =
				typeof toolResult.details === "object" && toolResult.details !== null
					? (toolResult.details as Record<string, unknown>)
					: {};
			const state =
				typeof details["status"] === "string"
					? details["status"]
					: details["sent"] === true
						? "sent"
						: details["spawned"] === true
							? "spawned"
							: "done";
			const target =
				typeof details["name"] === "string"
					? details["name"]
					: typeof details["target"] === "string"
						? details["target"]
						: "";
			const title = new Text(
				theme.fg(
					state === "blocked"
						? "warning"
						: state === "working"
							? "accent"
							: "success",
					[target, state].filter(Boolean).join(" · "),
				),
				0,
				0,
			);
			if (!options.expanded) return title;
			const reply =
				typeof details["reply"] === "string" ? details["reply"] : undefined;
			const ask =
				typeof details["ask"] === "object" && details["ask"] !== null
					? (details["ask"] as { prompts?: unknown })
					: undefined;
			const informational = Object.fromEntries(
				Object.entries(details).filter(
					([key]) => key !== "reply" && key !== "ask",
				),
			);
			if (
				!reply &&
				!Array.isArray(ask?.prompts) &&
				Object.keys(informational).length === 0
			) {
				return title;
			}
			const container = new Container();
			container.addChild(title);
			if (Object.keys(informational).length > 0) {
				container.addChild(new Spacer(1));
				container.addChild(
					new Text(JSON.stringify(informational, null, 2), 0, 0),
				);
			}
			if (reply) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(reply, 0, 0, getMarkdownTheme()));
			}
			if (Array.isArray(ask?.prompts)) {
				const titles = ask.prompts
					.flatMap((prompt) =>
						typeof prompt === "object" &&
						prompt !== null &&
						"title" in prompt &&
						typeof prompt.title === "string"
							? [prompt.title]
							: [],
					)
					.join(", ");
				if (titles) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("warning", titles), 0, 0));
				}
			}
			return container;
		},
	});
}
