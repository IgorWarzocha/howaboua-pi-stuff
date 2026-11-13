import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { nativeAgentName } from "./agent-identity.js";
import { reserveAgentName } from "./agents-work.js";
import { getSnapshot, resolvePiAgent, sessionPath } from "./core/agents.js";
import type { AgentFleet, ConnectedMachine } from "./fleet/index.js";
import { resumeAgentArgs, rollbackStartedAgent, startAgent } from "./launch.js";
import type { StartedAgent } from "./launch-contract.js";
import { prepareLaunchAncestry } from "./spawn-ancestry.js";
import {
	recordResumedChild,
	type SpawnOwnership,
	spawnedChildren,
} from "./spawn-ownership.js";
import type { PaneInfo } from "./types.js";

interface OwnedTarget {
	runtime: ConnectedMachine;
	panel: PaneInfo;
	resumed: boolean;
	restoreSupervision?: true;
}

function ownedTarget(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	resumed: boolean,
	child?: SpawnOwnership,
): OwnedTarget {
	return {
		runtime,
		panel,
		resumed,
		...(child &&
		child.supervised !== false &&
		!runtime.monitor
			.list()
			.some((record) => record.terminalId === panel.terminal_id)
			? { restoreSupervision: true as const }
			: {}),
	};
}

/** Parent-owned saved sessions, not a general session launcher or delivery retry. */
export class WorkerResumer {
	private readonly pending = new Map<string, Promise<OwnedTarget>>();
	private readonly pi: ExtensionAPI;
	private readonly fleet: AgentFleet;
	constructor(pi: ExtensionAPI, fleet: AgentFleet) {
		this.pi = pi;
		this.fleet = fleet;
	}

	async resolve(
		ctx: ExtensionContext,
		target: string,
		machine: string | undefined,
		signal: AbortSignal,
		allowResume = true,
	): Promise<OwnedTarget | undefined> {
		const selected = machine
			? this.fleet.connected(machine).machine
			: undefined;
		const children = spawnedChildren(ctx);
		// A current native address/name always wins over a saved routing alias.
		if (!target.startsWith("/")) {
			const runtime = this.fleet.connected(machine);
			const snapshot = await getSnapshot(runtime.client);
			const exact = snapshot.agents.find((panel) => panel.pane_id === target);
			const live = exact
				? [exact]
				: snapshot.agents.filter((panel) => panel.name === target);
			if (live.length) {
				const panel = await resolvePiAgent(
					runtime.client,
					target,
					runtime.local ? process.env["HC_TERMINAL_ID"] : "",
				);
				const machineId = runtime.local
					? this.fleet.localMachine()
					: runtime.machine;
				return ownedTarget(
					runtime,
					panel,
					false,
					children.find(
						(child) =>
							child.session === machineId &&
							child.sessionFile === sessionPath(panel),
					),
				);
			}
		}
		const candidates: { child: SpawnOwnership; runtime: ConnectedMachine }[] =
			[];
		for (const child of children) {
			const direct =
				child.agent === target ||
				child.pane === target ||
				child.terminal === target ||
				child.aliases?.includes(target) ||
				child.launch?.params.name === target;
			if (!direct && !(target.startsWith("/") && !child.agent)) continue;
			let runtime: ConnectedMachine;
			try {
				runtime = this.fleet.connected(child.session);
			} catch (error) {
				if (direct) throw error;
				continue;
			}
			if (selected !== undefined && runtime.machine !== selected) continue;
			if (!direct) {
				let header: { id: string; cwd: string };
				try {
					header = await runtime.client.sessionHeader(
						child.sessionFile,
						signal,
					);
				} catch {
					signal.throwIfAborted();
					continue;
				}
				if (`/${header.id}` !== target) continue;
			}
			candidates.push({ child, runtime });
		}
		if (!candidates.length) return undefined;
		if (candidates.length !== 1)
			throw new Error(
				"Multiple saved workers match this target; specify its session identity and machine",
			);
		const { child, runtime } = candidates[0]!;
		const key = JSON.stringify([
			ctx.sessionManager.getSessionId(),
			child.session,
			child.sessionFile,
		]);
		let work = this.pending.get(key);
		if (!work) {
			work = this.open(ctx, child, runtime, signal, allowResume);
			this.pending.set(key, work);
			void work
				.finally(() => {
					if (this.pending.get(key) === work) this.pending.delete(key);
				})
				.catch(() => {});
		}
		const resolved = await work;
		signal.throwIfAborted();
		return resolved;
	}

	private async open(
		ctx: ExtensionContext,
		child: SpawnOwnership,
		runtime: ConnectedMachine,
		signal: AbortSignal,
		allowResume: boolean,
	): Promise<OwnedTarget> {
		const sessionId = ctx.sessionManager.getSessionId();
		const current = () => {
			signal.throwIfAborted();
			if (
				ctx.sessionManager.getSessionId() !== sessionId ||
				!spawnedChildren(ctx).some(
					(entry) =>
						entry.parent === child.parent &&
						entry.session === child.session &&
						entry.sessionFile === child.sessionFile,
				)
			)
				throw new Error(
					"Controller changed; retry from the worker's original parent session",
				);
		};
		current();
		const identity = await runtime.client.machineIdentity();
		if (identity.session !== child.session)
			throw new Error(
				"Worker's machine changed; reconnect its original machine before resuming",
			);
		const snapshot = await getSnapshot(runtime.client);
		const live = snapshot.agents.filter(
			(panel) => sessionPath(panel) === child.sessionFile,
		);
		current();
		if (live.length > 1)
			throw new Error(
				"Worker is running in multiple terminals; close the extra session before sending",
			);
		if (live[0]) {
			if (
				child.agent &&
				(await nativeAgentName(runtime.client, live[0], signal)) !== child.agent
			)
				throw new Error(
					"Worker identity changed; resolve its current session before sending",
				);
			return ownedTarget(runtime, live[0], false, child);
		}
		if (!allowResume)
			throw new Error("Worker is already closed; no session was resumed");
		const header = await runtime.client.sessionHeader(
			child.sessionFile,
			signal,
		);
		const agent = `/${header.id}`;
		if (child.agent && child.agent !== agent)
			throw new Error(
				"Saved worker identity changed; open its saved session manually",
			);
		const params = child.launch?.params ?? {
			name: `worker-${header.id.replaceAll("-", "").slice(0, 12)}`,
			cwd: header.cwd,
			placement: "terminal" as const,
		};
		const ancestry = await prepareLaunchAncestry(ctx, this.fleet, signal);
		current();
		const reservation = await reserveAgentName(runtime, params.name);
		let started: StartedAgent;
		try {
			started = await startAgent(
				runtime.client,
				{ name: reservation.name, cwd: params.cwd, placement: "terminal" },
				header.cwd,
				runtime.resolveDirectory,
				{
					agentArgs: [
						...resumeAgentArgs(child.launch?.args ?? []),
						"--session",
						child.sessionFile,
					],
					ancestry,
					signal,
				},
			);
		} finally {
			reservation.release();
		}
		try {
			current();
			if (
				sessionPath(started.agent) !== child.sessionFile ||
				(await nativeAgentName(runtime.client, started.agent, signal)) !== agent
			)
				throw new Error(
					"Resumed worker did not open its saved session; inspect the saved session before retrying",
				);
			current();
			recordResumedChild(
				this.pi,
				{ ...child, launch: child.launch ?? { args: [], params } },
				started.agent,
				agent,
			);
			return ownedTarget(runtime, started.agent, true, child);
		} catch (error) {
			return rollbackStartedAgent(runtime.client, started, error);
		}
	}
}
