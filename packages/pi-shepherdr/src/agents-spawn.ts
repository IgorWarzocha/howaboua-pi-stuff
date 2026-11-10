import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { nativeAgentName } from "./agent-identity.js";
import {
	type AgentsParams,
	requiredAgentField as required,
	shouldBlockAgentSpawn,
} from "./agents-contract.js";
import {
	dispatchAgentWork,
	reportProgress,
	reserveAgentName,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet, ConnectedMachine } from "./fleet/index.js";
import {
	resolvePreparationDirectory,
	rollbackStartedAgent,
	startAgent,
} from "./launch.js";
import { attributeAgentPrompt } from "./messages/attribution.js";
import {
	loadAgentProfiles,
	prepareProfileMessage,
	profileAgentArgs,
} from "./profiles.js";
import { isDispatchRejected } from "./remote/shepherdr-peer.mjs";
import type { SharedAgentContext } from "./shared-context.js";
import { prepareLaunchAncestry } from "./spawn-ancestry.js";
import { prepareSpawnOwnership } from "./spawn-ownership.js";

export async function spawnAgent(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	runtime: ConnectedMachine,
	params: AgentsParams,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	sharedContext: SharedAgentContext,
	ctx: ExtensionContext,
	board: AgentBoard,
) {
	const recordSpawn = prepareSpawnOwnership(pi, ctx, runtime);
	const boardThreadId =
		params.board_thread_id === undefined
			? undefined
			: required(params.board_thread_id, "board_thread_id");
	if (boardThreadId !== undefined) {
		await board.execute(
			ctx,
			{
				action: "read_thread",
				thread_id: boardThreadId,
				limit: 1,
				max_chars_per_post: 1,
			},
			crypto.randomUUID(),
		);
	}
	const profiles = await loadAgentProfiles();
	const profileName = required(params.agent_type, "agent_type");
	const profile = profiles.get(profileName);
	if (!profile) {
		throw new Error(
			`unknown agent_type ${JSON.stringify(profileName)}; available: ${[...profiles.keys()].join(", ")}`,
		);
	}
	const label = required(params.label, "label");
	const reservation = await reserveAgentName(runtime, label, params.name);
	const { name } = reservation;
	try {
		const placement = params.placement ?? "terminal";
		const workspace = params.workspace;
		const startParams = {
			name,
			label,
			placement,
			...(workspace ? { workspace } : {}),
			...(params.cwd ? { cwd: params.cwd } : {}),
		};
		const cwd = await resolvePreparationDirectory(
			startParams,
			runtime.fallbackCwd,
			runtime.resolveDirectory,
		);
		const input = required(params.message, "message");
		const message = await prepareProfileMessage(
			profile,
			{
				cwd,
				message: input,
				...(params.base ? { base: params.base } : {}),
			},
			{ targetLocal: runtime.local },
		);
		const attributedMessage = await attributeAgentPrompt(
			fleet.connected().client,
			ctx.sessionManager.getSessionId(),
			input.startsWith("/") ? input : message,
			"task",
			profile.prompt,
		);
		if (input.startsWith("/") && message !== input)
			attributedMessage.context = [attributedMessage.context, message]
				.filter(Boolean)
				.join("\n\n");
		if (boardThreadId !== undefined)
			attributedMessage.context = [
				attributedMessage.context,
				`Read shared board thread with board({action:"read_thread",thread_id:${JSON.stringify(boardThreadId)}}) for task context. To follow ongoing peer findings, subscribe to that thread for replies.`,
			]
				.filter(Boolean)
				.join("\n\n");
		reportProgress(onUpdate, `Spawning ${label}`, {
			machine: runtime.machine,
			name,
			profile: profile.name,
			status: "starting",
		});
		const agentArgs = profileAgentArgs(profile);
		const relationship = sharedContext.spawns.prepareRelationship(
			ctx,
			runtime,
			agentArgs,
		);
		const sharing =
			profile.shareContext === false
				? undefined
				: await sharedContext.spawns.prepare(ctx, runtime, agentArgs);
		const boardBinding = await board.prepare(ctx, runtime, name, agentArgs);
		if (boardThreadId !== undefined && !boardBinding)
			throw new Error(
				"Board thread context requires shared Board to be enabled before spawning",
			);
		const started = await startAgent(
			runtime.client,
			startParams,
			runtime.fallbackCwd,
			runtime.resolveDirectory,
			{
				agentArgs,
				signal,
				ancestry: await prepareLaunchAncestry(ctx, fleet, signal),
			},
		);
		let promptSubmissionStarted = false;
		let promptAccepted = false;
		let dispatch;
		let shared: { agentName?: string; warning?: string } | undefined;
		let boardShared: { agentName?: string; warning?: string } | undefined;
		let agentName: string | undefined;
		let relationshipWarning: string | undefined;
		let ownershipWarning: string | undefined;
		const blocking = shouldBlockAgentSpawn(profile.blocking, params.blocking);
		try {
			agentName = await nativeAgentName(runtime.client, started.agent, signal);
			relationshipWarning = (await relationship?.accept(started.agent))
				?.warning;
			boardShared = await boardBinding?.accept(started.agent);
			if (boardThreadId !== undefined && !boardShared?.agentName)
				throw new Error(
					"Worker cannot read the requested Board thread: the target needs Agent Board or Agent Comms. Load it and reload Pi before retrying",
				);
			shared = await sharing?.accept(started.agent);
			attributedMessage.context += `\n${await sharedContext.peerReplyContext(ctx, runtime, started.agent, signal)}`;
			dispatch = await dispatchAgentWork(
				runtime,
				started.agent,
				message,
				blocking,
				signal,
				onUpdate,
				async () => {
					promptSubmissionStarted = true;
					const receipt = await runtime.client.sendMessage(
						started.agent,
						attributedMessage,
					);
					promptAccepted = true;
					try {
						await recordSpawn(started.agent, agentArgs, agentName, startParams);
					} catch {
						ownershipWarning =
							"Submitted, but saved worker ownership could not be recorded. Automatic resume is unavailable; use its current target and do not resend the task";
					}
					return receipt;
				},
				{ expectUserMessage: true },
			);
		} catch (error) {
			if (
				!promptAccepted &&
				(!promptSubmissionStarted || isDispatchRejected(error))
			) {
				return await rollbackStartedAgent(runtime.client, started, error);
			}
			if (!promptAccepted) {
				try {
					await recordSpawn(started.agent, agentArgs, agentName, startParams);
				} catch (ownershipError) {
					throw new AggregateError(
						[error, ownershipError],
						"Worker delivery is unconfirmed and its ownership could not be saved. Inspect the target before sending the task again",
					);
				}
			}
			throw error;
		}
		return toolResult(
			{
				...(dispatch.command
					? {
							spawned: true,
							commandSubmitted: true,
							machine: runtime.machine,
							target: started.id,
							name,
						}
					: dispatch.settlement
						? {
								spawned: true,
								...settlementResult(runtime.machine, dispatch.settlement),
							}
						: {
								spawned: true,
								machine: runtime.machine,
								target: started.id,
								name,
								status: "working",
								next: "Do other work or end this turn; completion/blockage arrives automatically. Do not poll or await timers/extra Promises for reports",
							}),
				agent: agentName,
				...(boardBinding || sharing
					? {
							sharing: {
								board: !!boardShared?.agentName,
								context: !!shared?.agentName,
							},
						}
					: {}),
			},
			[
				dispatch.warning,
				boardShared?.warning,
				shared?.warning,
				relationshipWarning,
				ownershipWarning,
			]
				.filter(Boolean)
				.join("\n") || undefined,
		);
	} finally {
		reservation.release();
	}
}
