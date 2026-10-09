import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	recordContextBriefing,
	registerContextBriefing,
} from "@howaboua/pi-agent-board/integration";
import type { AgentFleet, ConnectedMachine } from "./fleet.js";
import {
	getAgent,
	getCurrentPane,
	resolvePiAgent,
	sessionPath,
} from "./herdr.js";
import { isDispatchRejected } from "./herdr-client.js";
import { focusArrivalContent } from "./messages.js";
import type { FocusRequest, PaneInfo } from "./types.js";
import { activeVoiceService, observeVoiceTransfer } from "./voice-handoff.js";

const ARRIVAL = "herdr-focus-arrival";

export async function focusAgent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	fleet: AgentFleet,
	runtime: ConnectedMachine,
	target: string,
	voice = false,
	handoff?: string,
) {
	const service = voice ? activeVoiceService(pi) : undefined;
	const local = fleet.connected();
	const source = await getCurrentPane(local.client);
	const sessionFile = sessionPath(source);
	if (!sessionFile)
		throw new Error("Focus requires a saved source session for returning");
	const panel = await resolvePiAgent(
		runtime.client,
		target,
		runtime.local ? source.pane_id : "",
	);
	if (
		!sessionPath(panel) ||
		panel.launch_pending ||
		panel.interactive_ready === false
	)
		throw new Error(
			"Target session is not running and ready; choose an existing running session",
		);
	const request: FocusRequest = {
		source: {
			...(await local.client.machineIdentity()),
			pane: source.pane_id,
			terminal: source.terminal_id,
			sessionFile,
		},
		...(handoff?.trim() ? { handoff } : {}),
		voice,
	};
	if (service) {
		const channel = await runtime.client.openFocusChannel(panel, request);
		let completion: Promise<void>;
		try {
			completion = service.depart(channel);
		} catch (error) {
			completion = Promise.reject(error);
		}
		observeVoiceTransfer(
			pi,
			ctx,
			completion,
			channel,
			"source",
			`${runtime.machine}/${panel.pane_id}`,
		);
		return {
			status: "transferring",
			machine: runtime.machine,
			target: panel.pane_id,
			voice: true,
			...(runtime.local ? {} : { display: "target-machine-only" }),
		};
	}
	await runtime.client.focus(panel, request);
	return {
		focused: true,
		machine: runtime.machine,
		target: panel.pane_id,
		voice: false,
		...(runtime.local ? {} : { display: "target-machine-only" }),
	};
}

export function readFocus(value: unknown): FocusRequest {
	if (!value || typeof value !== "object" || !("source" in value))
		throw new Error("Invalid focus arrival");
	if (
		!value.source ||
		typeof value.source !== "object" ||
		Array.isArray(value.source)
	)
		throw new Error("Invalid focus source");
	const source = value.source as Record<string, unknown>;
	for (const field of [
		"host",
		"session",
		"pane",
		"terminal",
		"sessionFile",
	] as const) {
		if (
			!(field in source) ||
			typeof source[field] !== "string" ||
			!source[field].trim()
		)
			throw new Error("Invalid focus source");
	}
	if ("handoff" in value && typeof value.handoff !== "string")
		throw new Error("Invalid focus handoff");
	if ("voice" in value && typeof value.voice !== "boolean")
		throw new Error("Invalid focus voice selection");
	return value as FocusRequest;
}

export async function acceptFocus(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	fleet: AgentFleet,
	pane: PaneInfo,
	value: unknown,
): Promise<void> {
	const request = readFocus(value);
	const source = request.source;
	const routes: string[] = [];
	for (const status of fleet.statuses()) {
		if (status.status !== "connected") continue;
		const runtime = fleet.connected(status.id);
		try {
			const identity = await runtime.client.machineIdentity();
			if (identity.host !== source.host || identity.session !== source.session)
				continue;
			const agent = await getAgent(runtime.client, source.pane);
			if (
				agent.agent === "pi" &&
				agent.terminal_id === source.terminal &&
				sessionPath(agent) === source.sessionFile &&
				!agent.launch_pending &&
				agent.interactive_ready !== false
			)
				routes.push(runtime.machine);
		} catch {
			// A disconnected or changed source is not a return route.
		}
	}
	if (!routes.length)
		throw new Error(
			"No live return route from the destination; ask the user to connect the source machine in the destination's /herdr panel, then retry",
		);
	const machine = routes.includes("local") ? "local" : routes[0]!;
	const tools = pi.getActiveTools();
	const { returnFocus, content } = focusArrivalContent(
		request,
		machine,
		tools.includes("exec") ||
			tools.includes("code") ||
			tools.includes("notebook"),
	);
	// Recheck the receiver session after remote route verification, before mutation.
	if (ctx.sessionManager.getSessionFile() !== sessionPath(pane))
		throw new Error("Destination session changed; resolve it again");
	const local = fleet.connected();
	const current = await getAgent(local.client, pane.pane_id);
	if (
		current.terminal_id !== pane.terminal_id ||
		sessionPath(current) !== sessionPath(pane)
	)
		throw new Error("Destination session changed; resolve it again");
	try {
		await local.client.request("agent.focus", { target: pane.pane_id });
	} catch (error) {
		if (isDispatchRejected(error)) throw error;
		throw Object.assign(
			new Error(
				`Focus was not confirmed; inspect the destination before retrying: ${String(error)}`,
			),
			{ focusChanged: true },
		);
	}
	// Custom data persists immediately, even during a tool call, without inserting
	// a model message between that call and its result or starting an agent turn.
	try {
		pi.appendEntry(ARRIVAL, {
			content,
			source: { ...source, machine },
			returnFocus,
			timestamp: Date.now(),
		});
		await recordContextBriefing(
			pi,
			ctx,
			ARRIVAL,
			randomUUID(),
			async () => content,
		);
	} catch (error) {
		throw Object.assign(
			new Error(
				`Session focused, but arrival could not be saved; inspect the destination before retrying: ${String(error)}`,
			),
			{ focusChanged: true },
		);
	}
	ctx.ui.notify("Session focused", "info");
}

export function registerFocusArrivals(pi: ExtensionAPI): void {
	registerContextBriefing(
		pi,
		"session arrivals",
		(ctx) =>
			ctx.sessionManager
				.getBranch()
				.some(
					(entry) =>
						entry.type === "custom" &&
						(entry.customType === ARRIVAL ||
							entry.customType === "herdr-voice-focus-report"),
				),
		async () => undefined,
	);
}
