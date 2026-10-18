import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { connectPulseRunner, isPulseRunNotStarted } from "./integration.js";
import { registerPulseControls } from "./src/controls.js";
import { catalog, type Definition, repository } from "./src/definitions.js";
import { isPulseDue, isPulseQuietAt, pulseDueKey } from "./src/schedule.js";
import { PulseStore } from "./src/state.js";

const RESULT_GUIDANCE =
	"Use appropriate available tools or destinations for substantive task results and logs. Your final assistant message to the main agent should briefly confirm completion and point to the outcome, without repeating it. Report failures, ambiguities or suggested improvements to the pulse procedure only in that final assistant message, separately from the completion summary. Do not put this procedural feedback in task logs, notes or boards. Do not edit the pulse definition unless its instructions explicitly authorise it.";

export default async function pulses(pi: ExtensionAPI) {
	const bridge = connectPulseRunner(pi);
	let context: ExtensionContext | undefined;
	let store: PulseStore | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;
	let busy = false;
	let pending = false;
	let stopped = false;
	let ready = false;
	let idle: (() => void) | undefined;
	const ownedIds = new Set<string>();
	const schedules = new Map<string, string>();
	const notify = (error: unknown) =>
		context?.ui.notify(
			error instanceof Error
				? error.message
				: "Pulses could not check its schedules.",
			"warning",
		);
	function finish() {
		busy = false;
		idle?.();
		idle = undefined;
		if (pending && !stopped) void tick(true);
	}
	async function storeFor(ctx: ExtensionContext) {
		if (store?.owner !== ctx.sessionManager.getSessionId())
			store = new PulseStore(
				await repository(ctx.cwd),
				ctx.sessionManager.getSessionId(),
			);
		return store;
	}
	function runnerFor(ctx: ExtensionContext) {
		const runner = bridge.service;
		if (!runner || !runner.isController(ctx))
			throw new Error(
				"Pulse execution is unavailable in this session. Run it from the main session with an available runner.",
			);
		return runner;
	}
	async function bind(
		definition: Definition,
		current: PulseStore,
		rebase: boolean,
	) {
		const created = await current.claim(definition.id);
		ownedIds.add(definition.id);
		const state = await current.read(definition.id);
		if (state.worker && state.worker.owner !== current.owner) {
			await current.history(definition.id, {
				event: "previous-owner-worker-preserved",
				worker: state.worker,
			});
			delete state.worker;
		}
		const schedule = JSON.stringify(definition.schedule);
		if (created || rebase || schedules.get(definition.id) !== schedule) {
			state.lastRunAt = Date.now();
			const key = pulseDueKey(definition.schedule, state.lastRunAt);
			if (key) state.lastDueKey = key;
			else delete state.lastDueKey;
		}
		await current.save(definition.id, state);
		schedules.set(definition.id, schedule);
	}
	async function run(
		ctx: ExtensionContext,
		current: PulseStore,
		definition: Definition,
		scheduled: boolean,
	) {
		const runner = runnerFor(ctx);
		const state = await current.read(definition.id);
		if (state.running)
			throw new Error(
				state.running.workerId
					? "This pulse already has active work. Use the existing agents tools to inspect or control it."
					: "A previous run remains unconfirmed, so further runs are blocked. Inspection alone cannot clear it. Follow manual recovery in the Pulses README after checking active work and its outcome.",
			);
		if (stopped || context?.sessionManager.getSessionId() !== current.owner)
			throw new Error("The main session changed; no run was requested.");
		const runId = randomUUID();
		const previousSchedule = {
			lastRunAt: state.lastRunAt,
			lastDueKey: state.lastDueKey,
		};
		state.running = { runId, startedAt: Date.now() };
		if (scheduled) {
			state.lastRunAt = state.running.startedAt;
			const key = pulseDueKey(definition.schedule, state.lastRunAt);
			if (key) state.lastDueKey = key;
		}
		await current.save(definition.id, state);
		await current.history(definition.id, {
			event: "admitted",
			runId,
			scheduled,
		});
		try {
			const receipt = await runner.start(ctx, {
				taskId: definition.id,
				title: definition.title,
				cwd: current.repo.root,
				runId,
				prompt: definition.body + "\n\n" + RESULT_GUIDANCE,
				...(state.worker?.owner === current.owner &&
				state.worker.runner === runner.id
					? { workerId: state.worker.workerId }
					: {}),
			});
			state.worker = {
				owner: current.owner,
				runner: runner.id,
				workerId: receipt.workerId,
			};
			state.running.workerId = receipt.workerId;
			await current.save(definition.id, state);
		} catch (error) {
			if (isPulseRunNotStarted(error)) {
				delete state.running;
				if (scheduled) {
					if (previousSchedule.lastRunAt === undefined) delete state.lastRunAt;
					else state.lastRunAt = previousSchedule.lastRunAt;
					if (previousSchedule.lastDueKey === undefined)
						delete state.lastDueKey;
					else state.lastDueKey = previousSchedule.lastDueKey;
				}
				await current.save(definition.id, state);
				await current.history(definition.id, {
					event: "dispatch-not-started",
					runId,
				});
				throw new Error(
					`Pulse did not start: ${error.message} Correct that condition and request this pulse again.`,
					{ cause: error },
				);
			}
			await current.history(definition.id, {
				event: "dispatch-unconfirmed",
				runId,
			});
			throw new Error(
				"The run could not be confirmed and remains blocked to avoid duplicate work. Check active agents and the task outcome, then follow manual recovery in the Pulses README. Inspection alone does not clear the block.",
			);
		}
	}
	async function reconcile(
		ctx: ExtensionContext,
		current: PulseStore,
		id: string,
	) {
		const state = await current.read(id);
		const runner = bridge.service;
		if (
			!state.running?.workerId ||
			!state.worker ||
			!runner ||
			state.worker.runner !== runner.id ||
			state.worker.owner !== current.owner
		)
			return;
		const receipt = await runner.inspect(ctx, state.worker.workerId);
		if (receipt.state === "working") return;
		await current.history(id, {
			event: "settled",
			runId: state.running.runId,
			state: receipt.state,
		});
		delete state.running;
		await current.save(id, state);
	}
	async function tick(checkWorkers = false) {
		if (checkWorkers) pending = true;
		if (
			busy ||
			stopped ||
			!ready ||
			!context ||
			context.mode !== "tui" ||
			!bridge.service?.isController(context)
		)
			return;
		busy = true;
		checkWorkers = pending;
		pending = false;
		const ctx = context;
		try {
			const current = await storeFor(ctx);
			if (checkWorkers)
				for (const id of ownedIds) {
					if (stopped || ctx.sessionManager.getSessionId() !== current.owner)
						break;
					try {
						if (await current.owned(id)) await reconcile(ctx, current, id);
					} catch (error) {
						notify(error);
					}
				}
			for (const item of await catalog(current.repo)) {
				if (stopped || ctx.sessionManager.getSessionId() !== current.owner)
					break;
				if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id)) continue;
				try {
					const owned = await current.owned(item.id);
					if (owned) {
						ownedIds.add(item.id);
					}
					if (!("definition" in item)) continue;
					const definition = item.definition;
					if (!owned) {
						if (definition.enabled && definition.schedule.kind !== "manual")
							await bind(definition, current, false);
						else continue;
					} else if (
						schedules.get(item.id) !== JSON.stringify(definition.schedule)
					) {
						// A live schedule edit starts here, without replaying its past slots.
						await bind(definition, current, true);
					}
					const state = await current.read(item.id);
					const now = Date.now();
					if (
						state.running ||
						!definition.enabled ||
						(definition.quietHours &&
							isPulseQuietAt(definition.quietHours, now))
					)
						continue;
					if (
						isPulseDue({ schedule: definition.schedule, nowMs: now, ...state })
							.due
					)
						await run(ctx, current, definition, true);
				} catch (error) {
					notify(error);
				}
			}
		} catch (error) {
			notify(error);
		} finally {
			finish();
		}
	}
	await registerPulseControls(pi, {
		async help(ctx) {
			const current = await storeFor(ctx);
			const items = await catalog(current.repo);
			const valid = items.flatMap((item) =>
				"definition" in item
					? [relative(current.repo.root, item.definition.path)]
					: [],
			);
			const invalid = items.flatMap((item) =>
				"error" in item ? [relative(current.repo.root, item.path)] : [],
			);
			return [
				'Run: {run:"check-new-issues"}; authoring: {skill:true}',
				...valid,
				...(invalid.length
					? ["", "Invalid definitions — see {skill:true}:", ...invalid]
					: []),
			].join("\n");
		},
		async run(ctx, id) {
			if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
				throw new Error(
					"Use a pulse filename without .md. Call pulses with no arguments to see valid paths.",
				);
			if (busy)
				throw new Error("A pulse request is being admitted. Retry shortly.");
			context = ctx;
			runnerFor(ctx);
			busy = true;
			try {
				const current = await storeFor(ctx);
				const item = (await catalog(current.repo)).find(
					(item) => item.id === id,
				);
				if (!item || !("definition" in item))
					throw new Error(
						"No valid pulse with that name. Call pulses without arguments, then read its definition or request {skill:true}.",
					);
				await bind(item.definition, current, false);
				await reconcile(ctx, current, id);
				await run(ctx, current, item.definition, false);
				return (
					"Requested " +
					relative(current.repo.root, item.definition.path) +
					". The result will wake this main agent."
				);
			} finally {
				finish();
			}
		},
	});
	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		store = undefined;
		stopped = false;
		ready = false;
		ownedIds.clear();
		schedules.clear();
		if (timer) clearInterval(timer);
		unsubscribe?.();
		unsubscribe = bridge.service?.subscribe(() => {
			void tick(true);
		});
	});
	pi.on("resources_discover", async (_event, ctx) => {
		context = ctx;
		if (ctx.mode !== "tui" || !bridge.service?.isController(ctx)) return;
		unsubscribe?.();
		unsubscribe = bridge.service.subscribe(() => {
			void tick(true);
		});
		try {
			const current = await storeFor(ctx);
			// Runtime ownership survives authoring-file deletion, including resume.
			for (const id of await current.ownedIds()) ownedIds.add(id);
			for (const item of await catalog(current.repo))
				if (
					/^[a-z0-9][a-z0-9-]*$/.test(item.id) &&
					(await current.owned(item.id))
				) {
					ownedIds.add(item.id);
					if ("definition" in item) await bind(item.definition, current, true);
				}
		} catch (error) {
			notify(error);
		}
		ready = true;
		if (timer) clearInterval(timer);
		timer = setInterval(() => {
			void tick();
		}, 5 * 60_000);
		timer.unref();
		await tick(true);
	});
	pi.on("session_shutdown", async () => {
		stopped = true;
		ready = false;
		if (timer) clearInterval(timer);
		unsubscribe?.();
		if (busy)
			await new Promise<void>((resolve) => {
				idle = resolve;
			});
		bridge.dispose();
		if (store)
			for (const id of ownedIds)
				if (!(await store.read(id)).running && (await store.owned(id)))
					await store.release(id);
	});
}
