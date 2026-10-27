import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { activityTask } from "./activity.js";
import type { ConnectedMachine } from "./fleet/index.js";
import { getSnapshot } from "./herdr.js";
import { type HerdrConnection, isDispatchRejected } from "./herdr-client.js";
import { agentSource } from "./messages/attribution.js";
import type { WorkAttempt } from "./monitor-state.js";
import type { ClaimedSettlement } from "./settlement/index.js";
import type { ExtensionReply, PaneInfo, PeerDelivery } from "./types.js";

export function toolResult(value: Record<string, unknown>, warning?: string) {
	if (warning) value = { ...value, next: warning };
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		details: value,
	};
}

export function reportProgress(
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	message: string,
	details: Record<string, unknown>,
): void {
	onUpdate({
		content: [{ type: "text", text: message }],
		details,
	});
}

function slugify(value: string): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	const named = /^[a-z]/u.test(slug) ? slug : `agent-${slug}`;
	return named.slice(0, 32).replace(/-+$/u, "") || "agent";
}

const startingNames = new WeakMap<HerdrConnection, Set<string>>();

export async function reserveAgentName(
	runtime: ConnectedMachine,
	label: string,
	requested?: string,
): Promise<{ name: string; release(): void }> {
	const snapshot = await getSnapshot(runtime.client);
	let reserved = startingNames.get(runtime.client);
	if (!reserved) {
		reserved = new Set<string>();
		startingNames.set(runtime.client, reserved);
	}
	const names = new Set([
		...snapshot.agents.flatMap((agent) => (agent.name ? [agent.name] : [])),
		...reserved,
	]);
	const name = requested?.trim() || availableAgentName(names, label);
	if (names.has(name))
		throw new Error(
			`Agent name ${JSON.stringify(name)} is already in use; omit name or choose another`,
		);
	reserved.add(name);
	return {
		name,
		release: () => {
			reserved.delete(name);
		},
	};
}

function availableAgentName(names: ReadonlySet<string>, label: string): string {
	const base = slugify(label);
	if (!names.has(base)) return base;
	for (let suffix = 2; suffix < 10_000; suffix += 1) {
		const tail = `-${suffix}`;
		const candidate = `${base.slice(0, 32 - tail.length).replace(/-+$/u, "")}${tail}`;
		if (!names.has(candidate)) return candidate;
	}
	throw new Error(
		`could not allocate an agent name for ${JSON.stringify(label)}`,
	);
}

export function settlementResult(
	machine: string,
	settlement: ClaimedSettlement,
	options: { reportWorkerError?: boolean } = {},
): Record<string, unknown> {
	const workerError =
		settlement.reply?.stopReason === "error"
			? settlement.reply.text ||
				`${settlement.agent.pane_id} assistant stopped with an error`
			: undefined;
	if (workerError && !options.reportWorkerError) throw new Error(workerError);
	const { pane, name, ...source } = agentSource(
		settlement.agent,
		settlement.labels,
	);
	return {
		machine,
		target: pane,
		...(name ? { name } : {}),
		source,
		status: settlement.status,
		...(workerError ? { worker_error: workerError } : {}),
		...(settlement.reply ? { reply: settlement.reply.text } : {}),
		...(settlement.extensionMessages
			? { extensionMessages: settlement.extensionMessages }
			: {}),
		...(settlement.blockedMessage
			? { blocked_on: settlement.blockedMessage }
			: {}),
		...(settlement.status === "done" &&
		!settlement.reply &&
		!settlement.extensionMessages?.length
			? { completed: true }
			: {}),
	};
}

export async function dispatchAgentWork(
	runtime: ConnectedMachine,
	panel: PaneInfo,
	task: string,
	blocking: boolean,
	signal: AbortSignal,
	onUpdate: AgentToolUpdateCallback<Record<string, unknown>>,
	send: () => Promise<PeerDelivery | void>,
	options: { expectUserMessage?: boolean; replyingTo?: ExtensionReply } = {},
): Promise<{
	settlement?: ClaimedSettlement;
	command?: true;
	warning?: string;
}> {
	signal.throwIfAborted();
	const addedWatch = !runtime.monitor
		.list()
		.some(
			(record) =>
				record.terminalId === panel.terminal_id ||
				record.paneId === panel.pane_id,
		);
	let attempt: WorkAttempt | undefined;
	let settlement: Promise<ClaimedSettlement> | undefined;
	let receipt: PeerDelivery | void;
	let sendStarted = false;
	try {
		await runtime.monitor.track(panel);
		const baseline = options.expectUserMessage
			? await runtime.monitor.view(panel)
			: undefined;
		attempt = runtime.monitor.beginWork(
			panel.pane_id,
			task,
			options.expectUserMessage ? (baseline?.input?.id ?? null) : undefined,
		);
		if (!attempt) throw new Error(`${panel.pane_id} is not monitored`);
		settlement = blocking
			? runtime.monitor.claimWork(attempt, signal, options.replyingTo)
			: undefined;
		void settlement?.catch(() => undefined);
		signal.throwIfAborted();
		sendStarted = true;
		receipt = await send();
	} catch (error) {
		if (settlement) runtime.monitor.releaseWorkClaim(attempt, error);
		if (sendStarted) await runtime.monitor.handleWorkFailure(attempt, error);
		else runtime.monitor.rejectWork(attempt);
		if (addedWatch && (!sendStarted || isDispatchRejected(error))) {
			const record = runtime.monitor
				.list()
				.find((record) => record.terminalId === panel.terminal_id);
			try {
				if (record?.scope === "task" && !activityTask(record.activity)) {
					await runtime.monitor.unwatch(record.paneId);
				}
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					"Delegation failed; temporary watch cleanup also failed",
				);
			}
		}
		throw error;
	}
	try {
		if (receipt?.command) {
			if (settlement)
				runtime.monitor.releaseWorkClaim(
					attempt,
					new Error("Command submitted without task waiting"),
				);
			runtime.monitor.rejectWork(attempt);
			if (addedWatch) {
				const record = runtime.monitor
					.list()
					.find((record) => record.terminalId === panel.terminal_id);
				if (record?.scope === "task" && !activityTask(record.activity))
					await runtime.monitor.unwatch(record.paneId);
			}
		} else {
			runtime.monitor.acceptWork(attempt);
			runtime.monitor.noteMessage(panel.pane_id, task);
		}
		await runtime.monitor.reconcileNow();
	} catch (error) {
		if (settlement) runtime.monitor.releaseWorkClaim(attempt, error);
		return {
			...(receipt?.command ? { command: true } : {}),
			warning: `Submitted, but monitoring refresh failed: ${error instanceof Error ? error.message : String(error)}. Inspect the target before resubmitting`,
		};
	}
	if (receipt?.command) return { command: true };
	if (!settlement) return {};
	reportProgress(onUpdate, `Waiting for ${panel.name ?? panel.pane_id}`, {
		machine: runtime.machine,
		target: panel.pane_id,
		status: "working",
	});
	return { settlement: await settlement };
}
