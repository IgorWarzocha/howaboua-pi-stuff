import { isAbsolute } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { activityTask } from "./activity.js";
import { dispatchAgentWork, reserveAgentName } from "./agents-work.js";
import type { AgentBoard } from "./board/host.js";
import type { AgentFleet } from "./fleet.js";
import { getSnapshot, sessionPath } from "./herdr.js";
import {
	RolledBackAgentLaunchError,
	rollbackStartedAgent,
	startAgent,
	UnstartedAgentLaunchError,
} from "./launch.js";
import { attributeAgentPrompt } from "./messages.js";
import { loadAgentProfiles, profileAgentArgs } from "./profiles.js";
import type { SharedAgentContext } from "./shared-context.js";
import type { PaneInfo } from "./types.js";
import { PULSE_WORKER_FLAG, type registerWorkerRole } from "./worker-role.js";

const ENTRY = "herdr-owned-worker-v1";
const RUNNER_PROTOCOL = "@howaboua/pi-pulses/runner/v1";
// Structural implementation of Pulses' optional runner ABI, without a private-package dependency.
interface PulseRun {
	taskId: string;
	title: string;
	prompt: string;
	cwd: string;
	runId: string;
	workerId?: string;
}
interface PulseWorker {
	workerId: string;
	state: "working" | "idle" | "closed";
}
interface OwnedWorker {
	workerId: string;
	pulseId: string;
	runId: string;
	parent: string;
	host: string;
	session: string;
	target: string;
	terminal: string;
	sessionPath: string;
	cwd: string;
}

function records(ctx: ExtensionContext): OwnedWorker[] {
	const workers = new Map<string, OwnedWorker>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
		const value = entry.data as Record<string, unknown> | undefined;
		if (
			!value ||
			![
				"workerId",
				"pulseId",
				"runId",
				"parent",
				"host",
				"session",
				"target",
				"terminal",
				"sessionPath",
				"cwd",
			].every((key) => typeof value[key] === "string")
		)
			throw new Error(
				"Saved pulse worker ownership is invalid; inspect the session before retrying",
			);
		const worker = value as unknown as OwnedWorker;
		if (worker.parent === ctx.sessionManager.getSessionFile())
			workers.set(worker.workerId, worker);
	}
	return [...workers.values()];
}

export function registerWorkerService(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	shared: SharedAgentContext,
	board: AgentBoard,
	workerRole: ReturnType<typeof registerWorkerRole>,
): void {
	let active: ExtensionContext | undefined;
	let busy = false;
	const isController = (ctx: ExtensionContext) =>
		ctx.mode === "tui" && !workerRole.isPulseWorker(ctx.sessionManager);
	function assertContext(ctx: ExtensionContext) {
		if (!isController(ctx))
			throw new Error("Detached workers cannot claim or schedule pulses");
		if (
			!active ||
			!ctx.sessionManager.getSessionFile() ||
			ctx.sessionManager.getSessionFile() !==
				active.sessionManager.getSessionFile()
		)
			throw new Error(
				"Worker service is unavailable for this session; retry after session startup",
			);
	}
	async function owned(ctx: ExtensionContext, workerId: string) {
		assertContext(ctx);
		const worker = records(ctx).find((value) => value.workerId === workerId);
		if (!worker) throw new Error("Worker is not owned by this session branch");
		const identity = await fleet.connected().client.machineIdentity();
		if (identity.host !== worker.host || identity.session !== worker.session)
			throw new Error("Worker belongs to another host or Herdr session");
		return worker;
	}
	async function panelFor(worker: OwnedWorker): Promise<PaneInfo | undefined> {
		const snapshot = await getSnapshot(fleet.connected().client);
		if (
			snapshot.agents.some(
				(value) =>
					value.pane_id !== worker.target &&
					sessionPath(value) === worker.sessionPath,
			)
		)
			throw new Error(
				"Worker session is open in another pane; refusing to control it",
			);
		const panel = snapshot.agents.find(
			(value) => value.pane_id === worker.target,
		);
		if (panel) {
			if (
				panel.pane_id === process.env["HERDR_PANE_ID"] ||
				panel.terminal_id !== worker.terminal ||
				panel.agent !== "pi" ||
				sessionPath(panel) !== worker.sessionPath
			)
				throw new Error("Worker pane identity changed; refusing to control it");
			return panel;
		}
		if (
			snapshot.agents.some((value) => sessionPath(value) === worker.sessionPath)
		)
			throw new Error(
				"Worker session is open in another pane; refusing to control it",
			);
		return undefined;
	}
	async function inspect(
		ctx: ExtensionContext,
		workerId: string,
	): Promise<PulseWorker> {
		const worker = await owned(ctx, workerId);
		const panel = await panelFor(worker);
		const record = fleet
			.connected()
			.monitor.list()
			.find((value) => value.terminalId === worker.terminal);
		return {
			workerId,
			state: !panel
				? "closed"
				: (panel.agent_status !== "idle" && panel.agent_status !== "done") ||
						panel.interactive_ready !== true ||
						panel.launch_pending ||
						(record &&
							(record.activity.phase !== "settled" ||
								activityTask(record.activity)))
					? "working"
					: "idle",
		};
	}
	const service = {
		protocol: RUNNER_PROTOCOL,
		id: "shepherdr",
		isController,
		inspect,
		subscribe: (listener: () => void) => fleet.subscribe(listener),
		async start(ctx: ExtensionContext, input: PulseRun) {
			let stage: "preflight" | "launch" | "dispatch" = "dispatch";
			try {
				stage = records(ctx).some(
					(worker) =>
						worker.pulseId === input.taskId && worker.runId === input.runId,
				)
					? "dispatch"
					: "preflight";
				assertContext(ctx);
				const parentFile = ctx.sessionManager.getSessionFile();
				const branchAnchor = ctx.sessionManager.getLeafId();
				const assertBranch = () => {
					assertContext(ctx);
					if (
						ctx.sessionManager.getSessionFile() !== parentFile ||
						(branchAnchor &&
							!ctx.sessionManager
								.getBranch()
								.some((entry) => entry.id === branchAnchor))
					)
						throw new Error(
							"Parent branch changed during worker startup; inspect before retrying",
						);
				};
				if (busy) throw new Error("A worker operation is already in progress");
				for (const field of [
					"taskId",
					"title",
					"prompt",
					"cwd",
					"runId",
				] as const)
					if (!input[field]?.trim()) throw new Error(`${field} is required`);
				if (!isAbsolute(input.cwd))
					throw new Error("Worker cwd must be absolute");
				if (input.prompt.trimStart().startsWith("/"))
					throw new Error("Scheduled work must be a task, not a slash command");
				busy = true;
				try {
					const runtime = fleet.connected();
					let worker = records(ctx).find(
						(value) => value.pulseId === input.taskId,
					);
					if (input.workerId && input.workerId !== worker?.workerId)
						throw new Error("Worker is not owned by this pulse in this branch");
					if (worker) await owned(ctx, worker.workerId);
					let panel = worker ? await panelFor(worker) : undefined;
					if (worker?.runId === input.runId) {
						stage = "dispatch";
						return await inspect(ctx, worker.workerId);
					}
					if (
						worker &&
						(await inspect(ctx, worker.workerId)).state === "working"
					)
						throw new Error("Worker already has active responsibility");
					if (worker && worker.cwd !== input.cwd)
						throw new Error(
							"Saved worker cwd differs; use its original working directory",
						);
					if (!panel) {
						const profile = (await loadAgentProfiles()).get("general");
						if (!profile)
							throw new Error("General worker profile is unavailable");
						const profileArgs = profileAgentArgs(profile, {
							includePrompt: false,
						});
						if (
							profileArgs.some((arg) =>
								/^(?:--(?:session(?:-id)?|continue|resume|no-session|fork)(?:=|$)|-[cr]$)/.test(
									arg,
								),
							)
						)
							throw new Error(
								"Worker profile cannot select an existing session",
							);
						const args = [
							...profileArgs,
							`--${PULSE_WORKER_FLAG}`,
							...(worker ? ["--session", worker.sessionPath] : []),
						];
						const reservation = await reserveAgentName(runtime, input.title);
						const { name } = reservation;
						try {
							const relationship = worker
								? undefined
								: shared.spawns.prepareRelationship(ctx, runtime, args);
							const sharing =
								worker || profile.shareContext === false
									? undefined
									: await shared.spawns.prepare(ctx, runtime, name, args);
							const boardBinding = worker
								? undefined
								: await board.prepare(ctx, runtime, name, args);
							const workspace = runtime.local
								? process.env["HERDR_WORKSPACE_ID"]
								: undefined;
							stage = "launch";
							const started = await startAgent(
								runtime.client,
								{
									name,
									label: input.title,
									cwd: input.cwd,
									placement: workspace ? "new_tab" : "new_workspace",
									...(workspace ? { workspace } : {}),
								},
								runtime.fallbackCwd,
								runtime.resolveDirectory,
								{ agentArgs: args },
							);
							try {
								const relationshipResult = await relationship?.accept(
									started.agent,
								);
								await boardBinding?.accept(started.agent);
								const sharingResult = await sharing?.accept(started.agent);
								for (const warning of [
									relationshipResult?.warning,
									sharingResult?.warning,
								])
									if (warning) ctx.ui.notify(warning, "warning");
								assertBranch();
								panel = started.agent;
								const file = sessionPath(panel);
								if (!file || (worker && file !== worker.sessionPath))
									throw new Error("Worker did not restore its saved session");
								const identity = await runtime.client.machineIdentity();
								worker = {
									workerId: worker?.workerId ?? crypto.randomUUID(),
									pulseId: input.taskId,
									runId: "",
									parent: ctx.sessionManager.getSessionFile()!,
									...identity,
									target: panel.pane_id,
									terminal: panel.terminal_id,
									sessionPath: file,
									cwd: input.cwd,
								};
								pi.appendEntry(ENTRY, worker);
							} catch (error) {
								return await rollbackStartedAgent(
									runtime.client,
									started,
									error,
								);
							}
							stage = "preflight";
						} finally {
							reservation.release();
						}
					}
					if (!worker) throw new Error("Worker ownership is unavailable");
					const attributed = await attributeAgentPrompt(
						runtime.client,
						input.prompt,
						"task",
					);
					assertBranch();
					const dispatch = await dispatchAgentWork(
						runtime,
						panel,
						input.prompt,
						false,
						new AbortController().signal,
						() => {},
						() => {
							assertBranch();
							stage = "dispatch";
							return runtime.client.sendMessage(panel!, attributed);
						},
						{ expectUserMessage: true },
					);
					worker = { ...worker, runId: input.runId };
					assertBranch();
					pi.appendEntry(ENTRY, worker);
					if (dispatch.warning) ctx.ui.notify(dispatch.warning, "warning");
					return inspect(ctx, worker.workerId);
				} finally {
					busy = false;
				}
			} catch (error) {
				if (
					stage === "preflight" ||
					(stage === "launch" &&
						(error instanceof RolledBackAgentLaunchError ||
							error instanceof UnstartedAgentLaunchError))
				)
					throw Object.assign(
						new Error(error instanceof Error ? error.message : String(error), {
							cause: error,
						}),
						{ dispatched: false as const },
					);
				throw error;
			}
		},
	};
	pi.events.on(`${RUNNER_PROTOCOL}/request`, (request: unknown) => {
		const value = request as {
			protocol?: unknown;
			accept?: (value: typeof service) => void;
		};
		if (
			value?.protocol === RUNNER_PROTOCOL &&
			typeof value.accept === "function"
		)
			value.accept(service);
	});
	pi.on("session_start", () => {
		active = undefined;
	});
	pi.on("resources_discover", (_event, ctx) => {
		active = ctx;
	});
	pi.on("session_shutdown", () => {
		active = undefined;
	});
}
