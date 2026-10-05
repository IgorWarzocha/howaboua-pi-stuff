import type {
	AgentToolUpdateCallback,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type AgentsParams,
	requiredAgentField as required,
	shouldBlockAgentSpawn,
} from "./agents-contract.js";
import {
	allocateAgentName,
	dispatchAgentWork,
	reportProgress,
	settlementResult,
	toolResult,
} from "./agents-work.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet, ConnectedMachine } from "./fleet.js";
import { isDispatchRejected } from "./herdr-client.js";
import {
	resolvePreparationDirectory,
	rollbackStartedAgent,
	startAgent,
} from "./launch.js";
import { attributeAgentPrompt } from "./messages.js";
import {
	loadAgentProfiles,
	prepareProfileMessage,
	profileAgentArgs,
} from "./profiles.js";
import type { SharedAgentContext } from "./shared-context.js";

function agentLabel(value: string | undefined): string {
	const label = required(value, "label");
	const words = label.split(/\s+/u);
	if (words.length < 2 || words.length > 3) {
		throw new Error("label must contain 2 or 3 words");
	}
	return label;
}

export async function spawnAgent(
	fleet: AgentFleet,
	runtime: ConnectedMachine,
	params: AgentsParams,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	sharedContext: SharedAgentContext,
	ctx: ExtensionContext,
	board: AgentBoard,
) {
	const profiles = await loadAgentProfiles();
	const profileName = required(params.agent_type, "agent_type");
	const profile = profiles.get(profileName);
	if (!profile) {
		throw new Error(
			`unknown agent_type ${JSON.stringify(profileName)}; available: ${[...profiles.keys()].join(", ")}`,
		);
	}
	const label = agentLabel(params.label);
	const name = params.name?.trim() || (await allocateAgentName(runtime, label));
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
		input.startsWith("/") ? input : message,
		"task",
	);
	if (input.startsWith("/") && message !== input)
		attributedMessage.context = [attributedMessage.context, message]
			.filter(Boolean)
			.join("\n\n");
	reportProgress(onUpdate, `Spawning ${label}`, {
		machine: runtime.machine,
		name,
		profile: profile.name,
		status: "starting",
	});
	const agentArgs = profileAgentArgs(profile, { targetLocal: runtime.local });
	const sharing =
		profile.shareContext === false
			? undefined
			: await sharedContext.prepare(ctx, runtime, name, agentArgs);
	const boardBinding = await board.prepare(ctx, runtime, name, agentArgs);
	const started = await startAgent(
		runtime.client,
		startParams,
		runtime.fallbackCwd,
		runtime.resolveDirectory,
		{ agentArgs },
	);
	let promptSubmissionStarted = false;
	let promptAccepted = false;
	let dispatch;
	let shared: { agentName?: string; warning?: string } | undefined;
	let boardAgent: string | undefined;
	const blocking = shouldBlockAgentSpawn(profile.blocking, params.blocking);
	try {
		boardAgent = await boardBinding?.accept(started.agent);
		shared = await sharing?.accept(started.agent);
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
				return receipt;
			},
			{ expectUserMessage: true },
		);
	} catch (error) {
		if (
			!promptAccepted &&
			(!promptSubmissionStarted || isDispatchRejected(error))
		) {
			return rollbackStartedAgent(runtime.client, started, error);
		}
		throw error;
	}
	return toolResult(
		{
			...(boardAgent ? { boardAgent } : {}),
			...(shared?.agentName ? { contextAgent: shared.agentName } : {}),
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
							next: "Converse, do other work or reply now; completion/blockage arrives even after you reply. No polling or sleep waits",
						}),
		},
		[dispatch.warning, shared?.warning].filter(Boolean).join("\n") || undefined,
	);
}
