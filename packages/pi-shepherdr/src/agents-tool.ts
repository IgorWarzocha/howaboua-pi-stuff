import {
	defineTool,
	type ExtensionAPI,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { resolveNativeAgent } from "./agent-identity.js";
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
import { focusAgent } from "./agents-focus.js";
import { replyAgent } from "./agents-reply.js";
import { spawnAgent } from "./agents-spawn.js";
import {
	dispatchAgentWork,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import type { AgentBoard } from "./board/host.js";
import { resolvePiAgent } from "./core/agents.js";
import type { AgentFleet } from "./fleet/index.js";
import { attributeAgentPrompt } from "./messages/attribution.js";
import type { createPeerCommands } from "./peer-commands.js";
import type { SharedAgentContext } from "./shared-context.js";
import { setChildSupervision } from "./spawn-ownership.js";
import { WorkerResumer } from "./worker-resume.js";

export function createAgentsTool(
	fleet: AgentFleet,
	sharedContext: SharedAgentContext,
	board: AgentBoard,
	pi: ExtensionAPI,
	commands: ReturnType<typeof createPeerCommands>,
) {
	const resumer = new WorkerResumer(pi, fleet);
	return defineTool({
		name: "agents",
		label: "Shepherdr",
		description: "Delegate to persistent agents; {} lists action fields",
		promptGuidelines: [
			"agents: MUST use for supported local and remote agent operations. Report blockers instead of bypassing via hc or shell",
			...(process.env["HC_TERMINAL_ID"] && process.env["HC_TERMINAL_SOCKET"]
				? [
						"agents: Herdr active. Non-agent terminals and remote machine tools → hc --skill. Window layout → herdr-app --skill",
					]
				: []),
		],
		parameters: AgentsParameters,
		prepareArguments: parseAgentsRequest,
		executionMode: "parallel",
		async execute(_toolCallId, input: AgentsToolParams, signal, onUpdate, ctx) {
			const params = parseAgentsRequest(input);
			const executionSignal = signal ?? new AbortController().signal;
			const update = onUpdate ?? (() => undefined);
			if (params.action === "help" && !params.commands) {
				return toolResult(await agentsHelp(board.enabled(ctx)));
			}
			if (params.commands && params.target === undefined)
				return toolResult({ commands: commands.available() });
			if (params.action === "list") {
				return toolResult(await listFleetAgents(fleet, params));
			}
			if (params.action === "find") {
				return toolResult(await findFleetAgents(fleet, params));
			}

			let runtime = fleet.connected(params.machine);
			if (params.action === "spawn") {
				return spawnAgent(
					pi,
					fleet,
					runtime,
					params,
					executionSignal,
					update,
					sharedContext,
					ctx,
					board,
				);
			}

			let target = required(params.target, "target");
			const outgoing =
				params.action === "send"
					? {
							text: required(
								params.task ?? params.message,
								params.task === undefined ? "message" : "task",
							),
							delegate: params.task !== undefined,
							wait: params.wait === true,
						}
					: undefined;
			const owned =
				outgoing && target !== "/root"
					? await resumer.resolve(
							ctx,
							target,
							params.machine,
							executionSignal,
							!/^\/quit(?:\s|$)/.test(outgoing.text),
						)
					: undefined;
			if (owned) {
				runtime = owned.runtime;
				target = owned.panel.pane_id;
			}
			if (target === "/root") {
				const root = await sharedContext.resolveRoot(
					ctx,
					params.machine,
					executionSignal,
				);
				runtime = root.runtime;
				target = root.target;
			} else if (target.startsWith("/") && !target.slice(1).includes("/")) {
				const native = await resolveNativeAgent(
					fleet,
					target,
					params.machine,
					executionSignal,
				);
				runtime = native.runtime;
				target = native.panel.pane_id;
			}
			if (params.action === "focus") {
				executionSignal.throwIfAborted();
				return toolResult(
					await focusAgent(
						pi,
						ctx,
						fleet,
						runtime,
						target,
						params.voice ?? false,
						params.handoff,
					),
				);
			}
			if (params.action === "watch" && !params.enabled) {
				const record = runtime.monitor
					.list()
					.find((agent) => agent.paneId === target || agent.name === target);
				if (!record) {
					return toolResult({
						watched: false,
						machine: runtime.machine,
						target,
					});
				}
				await runtime.monitor.unwatch(record.paneId);
				setChildSupervision(
					pi,
					ctx,
					runtime.local ? fleet.localMachine() : runtime.machine,
					{ pane_id: record.paneId },
					false,
				);
				return toolResult({
					watched: false,
					machine: runtime.machine,
					target: record.paneId,
				});
			}

			const panel =
				owned?.panel ??
				(await resolvePiAgent(
					runtime.client,
					target,
					runtime.local ? process.env["HC_TERMINAL_ID"] : "",
				));
			if (params.commands) {
				return toolResult({
					machine: runtime.machine,
					target: panel.pane_id,
					commands: await runtime.client.commands(panel),
				});
			}
			if (params.action === "sharing") {
				return toolResult(
					await sharedContext.attachment[params.operation](
						ctx,
						runtime,
						panel,
						{
							context: params.scope !== "board",
							board: params.scope !== "context",
						},
						executionSignal,
					),
				);
			}
			if (params.action === "watch") {
				await runtime.monitor.watch(panel);
				setChildSupervision(
					pi,
					ctx,
					runtime.local ? fleet.localMachine() : runtime.machine,
					panel,
					true,
				);
				return toolResult({
					watched: true,
					machine: runtime.machine,
					target: panel.pane_id,
					next: "Completion and blockers reported automatically. Do not poll",
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
					...(view.extensionMessages
						? { extensionMessages: view.extensionMessages }
						: {}),
				});
			}
			if (outgoing) {
				const { text: message, delegate, wait } = outgoing;
				const attributedMessage = await attributeAgentPrompt(
					fleet.connected().client,
					ctx.sessionManager.getSessionId(),
					message,
					delegate ? "task" : "message",
				);
				attributedMessage.context = [
					attributedMessage.context,
					await sharedContext.peerReplyContext(
						ctx,
						runtime,
						panel,
						executionSignal,
					),
				]
					.filter(Boolean)
					.join("\n");
				if (!delegate && !owned?.restoreSupervision) {
					executionSignal.throwIfAborted();
					const receipt = await runtime.client.sendMessage(
						panel,
						attributedMessage,
					);
					if (!receipt.command)
						runtime.monitor.noteMessage(panel.pane_id, message);
					return toolResult({
						sent: true,
						...(owned?.resumed ? { resumed: true } : {}),
						...(receipt.command ? { commandSubmitted: true } : {}),
						machine: runtime.machine,
						target: panel.pane_id,
					});
				}
				const dispatch = await dispatchAgentWork(
					runtime,
					panel,
					message,
					wait,
					executionSignal,
					update,
					() => runtime.client.sendMessage(panel, attributedMessage),
					{
						expectUserMessage: true,
					},
				);
				if (!delegate)
					return toolResult(
						{
							sent: true,
							...(owned?.resumed ? { resumed: true } : {}),
							...(dispatch.command ? { commandSubmitted: true } : {}),
							machine: runtime.machine,
							target: panel.pane_id,
						},
						dispatch.warning,
					);
				return toolResult(
					{
						...(owned?.resumed ? { resumed: true } : {}),
						...(dispatch.command
							? {
									commandSubmitted: true,
									machine: runtime.machine,
									target: panel.pane_id,
								}
							: dispatch.settlement
								? {
										delegated: true,
										...settlementResult(runtime.machine, dispatch.settlement),
									}
								: {
										delegated: true,
										machine: runtime.machine,
										target: panel.pane_id,
										status: "working",
										next: "Completion and blockers reported automatically. Do not poll",
									}),
					},
					dispatch.warning,
				);
			}
			if (params.action === "reply") {
				return replyAgent(runtime, panel, params, executionSignal, update);
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
			const title = new Text(
				theme.fg(
					context && "isBlocked" in context && context.isBlocked === true
						? "warning"
						: "toolTitle",
					theme.bold(`agents ${params?.action ?? "request"}`),
				) + (identity ? theme.fg("muted", ` · ${identity}`) : ""),
				0,
				0,
			);
			const message = params?.task ?? params?.message ?? params?.handoff;
			if (!context?.expanded || !message) return title;
			const container = new Container();
			container.addChild(title);
			container.addChild(new Spacer(1));
			container.addChild(new Text(message, 0, 0));
			return container;
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
			const informational = Object.fromEntries(
				Object.entries(details).filter(([key]) => key !== "reply"),
			);
			if (!reply && Object.keys(informational).length === 0) {
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

			return container;
		},
	});
}
