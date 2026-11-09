import { isAbsolute } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	WORKER_PROTOCOL,
	type WorkerService,
	type WorkerStart,
	type WorkerStatus,
} from "../worker-api.js";
import { activityTask } from "./activity.js";
import { dispatchAgentWork, reserveAgentName } from "./agents-work.js";
import type { AgentBoard } from "./board/host.js";
import { sessionPath } from "./core/agents.js";
import type { AgentFleet } from "./fleet/index.js";
import {
	RolledBackAgentLaunchError,
	resumeAgentArgs,
	rollbackStartedAgent,
	startAgent,
	UnstartedAgentLaunchError,
} from "./launch.js";
import { attributeAgentPrompt } from "./messages/attribution.js";
import { loadAgentProfiles, profileAgentArgs } from "./profiles.js";
import type { SharedAgentContext } from "./shared-context.js";
import { prepareLaunchAncestry } from "./spawn-ancestry.js";
import { ENTRY, panelFor, records } from "./worker-ownership.js";
import type { registerWorkerRole } from "./worker-role.js";

export function registerWorkerService(
	pi: ExtensionAPI,
	fleet: AgentFleet,
	shared: SharedAgentContext,
	board: AgentBoard,
	workerRole: ReturnType<typeof registerWorkerRole>,
): void {
	let active: ExtensionContext | undefined;
	let busy: Pick<WorkerStart, "scope" | "key" | "requestId"> | undefined;
	function assertContext(ctx: ExtensionContext) {
		if (
			ctx.mode !== "tui" ||
			!active ||
			!ctx.sessionManager.getSessionFile() ||
			ctx.sessionManager.getSessionFile() !==
				active.sessionManager.getSessionFile()
		)
			throw new Error(
				"Worker service is unavailable for this session; retry after session startup",
			);
	}
	async function owned(ctx: ExtensionContext, scope: string, workerId: string) {
		assertContext(ctx);
		const worker = records(ctx).find(
			(value) => value.scope === scope && value.workerId === workerId,
		);
		if (!worker) throw new Error("Worker is not owned by this session branch");
		const identity = await fleet.connected().client.machineIdentity();
		if (identity.host !== worker.host || identity.session !== worker.session)
			throw new Error("Worker belongs to another host or Core");
		return worker;
	}

	async function inspect(
		ctx: ExtensionContext,
		scope: string,
		workerId: string,
	): Promise<WorkerStatus> {
		const worker = await owned(ctx, scope, workerId);
		const panel = await panelFor(fleet, worker);
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
	const service: WorkerService = {
		protocol: WORKER_PROTOCOL,
		id: "shepherdr-workers-v1",
		isWorker: (ctx) => workerRole.isWorker(ctx.sessionManager),
		inspect,
		subscribe: (listener: () => void) => fleet.subscribe(listener),
		async start(ctx: ExtensionContext, input: WorkerStart) {
			let stage: "preflight" | "launch" | "dispatch" = "preflight";
			try {
				if (!input || typeof input !== "object")
					throw new Error("Worker request is required");
				stage = records(ctx).some(
					(worker) =>
						worker.scope === input.scope &&
						worker.key === input.key &&
						worker.requestId === input.requestId,
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
				if (busy) {
					if (
						busy.scope === input.scope &&
						busy.key === input.key &&
						busy.requestId === input.requestId
					)
						stage = "dispatch";
					throw new Error("A worker operation is already in progress");
				}
				for (const field of [
					"scope",
					"key",
					"title",
					"prompt",
					"cwd",
					"requestId",
				] as const)
					if (typeof input[field] !== "string" || !input[field].trim())
						throw new Error(`${field} is required`);
				if (
					input.workerId !== undefined &&
					(typeof input.workerId !== "string" || !input.workerId.trim())
				)
					throw new Error("workerId must be a non-empty string");
				if (
					input.lifetime !== undefined &&
					input.lifetime !== "parent" &&
					input.lifetime !== "detached"
				)
					throw new Error("Worker lifetime must be parent or detached");
				const lifetime = input.lifetime ?? "parent";
				if (!isAbsolute(input.cwd))
					throw new Error("Worker cwd must be absolute");
				if (input.prompt.trimStart().startsWith("/"))
					throw new Error("Worker work must be a task, not a slash command");
				busy = {
					scope: input.scope,
					key: input.key,
					requestId: input.requestId,
				};
				try {
					const runtime = fleet.connected();
					let worker = records(ctx).find(
						(value) => value.scope === input.scope && value.key === input.key,
					);
					if (input.workerId && input.workerId !== worker?.workerId)
						throw new Error(
							"Worker is not owned by this caller in this branch",
						);
					if (worker) await owned(ctx, input.scope, worker.workerId);
					if (worker && worker.lifetime !== lifetime)
						throw new Error(
							"Worker lifetime differs; use its original lifetime or another key",
						);
					let panel = worker ? await panelFor(fleet, worker) : undefined;
					if (worker?.requestId === input.requestId) {
						stage = "dispatch";
						return await inspect(ctx, input.scope, worker.workerId);
					}
					if (
						worker &&
						(await inspect(ctx, input.scope, worker.workerId)).state ===
							"working"
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
							...(worker ? resumeAgentArgs(profileArgs) : profileArgs),
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
									: await shared.spawns.prepare(ctx, runtime, args);
							const boardBinding = worker
								? undefined
								: await board.prepare(ctx, runtime, name, args);
							stage = "launch";
							const started = await startAgent(
								runtime.client,
								{
									name,
									...(worker ? {} : { label: input.title }),
									cwd: input.cwd,
									placement: "terminal",
									...(lifetime === "detached"
										? { outliveParent: true as const }
										: {}),
								},
								runtime.fallbackCwd,
								runtime.resolveDirectory,
								{
									agentArgs: args,
									ancestry: await prepareLaunchAncestry(ctx, fleet),
								},
							);
							try {
								const relationshipResult = await relationship?.accept(
									started.agent,
								);
								const boardResult = await boardBinding?.accept(started.agent);
								const sharingResult = await sharing?.accept(started.agent);
								for (const warning of [
									relationshipResult?.warning,
									boardResult?.warning,
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
									scope: input.scope,
									lifetime,
									key: input.key,
									requestId: worker?.requestId ?? "",
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
					attributed.context += `\n${await shared.peerReplyContext(ctx, runtime, panel)}`;
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
					worker = { ...worker, requestId: input.requestId };
					assertBranch();
					pi.appendEntry(ENTRY, worker);
					if (dispatch.warning) ctx.ui.notify(dispatch.warning, "warning");
					return inspect(ctx, input.scope, worker.workerId);
				} finally {
					busy = undefined;
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
	pi.events.on(`${WORKER_PROTOCOL}/request`, (request: unknown) => {
		const value = request as {
			protocol?: unknown;
			accept?: (value: typeof service) => void;
		};
		if (
			value?.protocol === WORKER_PROTOCOL &&
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
