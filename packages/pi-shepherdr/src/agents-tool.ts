import { defineTool, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { answerAgent } from "./agents-answer.js";
import {
	AgentsParameters,
	type AgentsParams,
	type AgentsToolParams,
	parseAgentsRequest,
	requiredAgentField as required,
} from "./agents-contract.js";
import {
	agentsHelp,
	findFleetAgents,
	listFleetAgents,
	readAgentTerminal,
} from "./agents-discovery.js";
import { spawnAgent } from "./agents-spawn.js";
import {
	dispatchAgentWork,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import type { AgentFleet } from "./fleet.js";
import { resolvePiAgent } from "./herdr.js";
import { attributeAgentPrompt, modelAsk } from "./messages.js";

export function createAgentsTool(fleet: AgentFleet) {
	return defineTool({
		name: "agents",
		label: "Shepherdr",
		description: "Delegate to persistent agents; call help first, alone",
		parameters: AgentsParameters,
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
				return spawnAgent(fleet, runtime, params, executionSignal, update);
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
								ask: modelAsk(view.ask),
							}
						: {}),
				});
			}
			if (params.action === "send" || params.action === "assign") {
				if (panel.agent_status === "blocked") {
					const view = await runtime.monitor.view(panel);
					throw new Error(
						`${panel.pane_id} is blocked${view.ask ? " on ask; use action=answer" : ""}`,
					);
				}
				const message = required(params.message, "message");
				const attributedMessage = await attributeAgentPrompt(
					fleet.connected().client,
					message,
					params.action === "send" ? "message" : "task",
				);
				if (params.action === "send") {
					executionSignal.throwIfAborted();
					const receipt = await runtime.client.sendMessage(
						panel,
						attributedMessage,
					);
					return toolResult({
						sent: true,
						...(receipt.command ? { commandSubmitted: true } : {}),
						machine: runtime.machine,
						target: panel.pane_id,
					});
				}
				const dispatch = await dispatchAgentWork(
					runtime,
					panel,
					message,
					params.blocking !== false,
					executionSignal,
					update,
					() => runtime.client.sendMessage(panel, attributedMessage),
					{ expectUserMessage: true },
				);
				return toolResult(
					dispatch.command
						? {
								commandSubmitted: true,
								machine: runtime.machine,
								target: panel.pane_id,
							}
						: dispatch.settlement
							? {
									assigned: true,
									...settlementResult(runtime.machine, dispatch.settlement),
								}
							: {
									assigned: true,
									machine: runtime.machine,
									target: panel.pane_id,
									status: "working",
									next: "Completion or blockage will be delivered automatically; do not poll",
								},
					dispatch.warning,
				);
			}
			if (params.action === "answer") {
				return answerAgent(runtime, panel, params, executionSignal, update);
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
