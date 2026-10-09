import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../config.ts";
import type { CodexVoiceController } from "./controller.ts";
import {
	type IncomingVoiceHandoff,
	startVoiceArrival,
} from "./handoff-arrival.ts";
import {
	isVoiceHandoffRequest,
	VOICE_HANDOFF_PROTOCOL,
	VOICE_HANDOFF_REQUEST,
	type VoiceHandoffChannel,
	type VoiceHandoffService,
} from "./handoff-contract.ts";
import { startVoiceDeparture } from "./handoff-departure.ts";
import { asError } from "./handoff-wire.ts";

export function registerVoiceHandoff(options: {
	pi: ExtensionAPI;
	voice: CodexVoiceController;
	getConfig(): GippityControlConfig;
	priority(): number;
}): void {
	const { pi, voice } = options;
	let context: ExtensionContext | undefined;
	let pending: object | undefined;
	let incoming: IncomingVoiceHandoff | undefined;
	const connections = new Set<{ close(): void }>();
	const settledListeners = new Set<() => void>();

	const waitForSettled = (
		ctx: ExtensionContext,
		signal: AbortSignal,
	): Promise<void> => {
		signal.throwIfAborted();
		if (ctx.isIdle()) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const finish = (error?: Error) => {
				clearTimeout(timeout);
				settledListeners.delete(settled);
				signal.removeEventListener("abort", aborted);
				if (error) reject(error);
				else resolve();
			};
			const settled = () => finish();
			const aborted = () => finish(new Error("Voice transfer cancelled"));
			const timeout = setTimeout(
				() =>
					finish(
						new Error("Source agent did not settle before voice transfer"),
					),
				120_000,
			);
			settledListeners.add(settled);
			signal.addEventListener("abort", aborted, { once: true });
		});
	};
	const reserve = (): { ctx: ExtensionContext; reservation: object } => {
		if (!context)
			throw new Error("This Pi session is not ready for voice transfer");
		if (pending) throw new Error("A voice transfer is already preparing");
		const reservation = {};
		pending = reservation;
		return { ctx: context, reservation };
	};
	const rejectChannel = (channel: VoiceHandoffChannel, error: unknown) => {
		try {
			channel.send({ type: "failure", message: asError(error).message });
		} catch {
			/* The rejected service promise retains the failure if transport is gone. */
		} finally {
			channel.close();
		}
	};
	const service: VoiceHandoffService = {
		protocol: VOICE_HANDOFF_PROTOCOL,
		get priority() {
			return options.priority();
		},
		status() {
			return {
				active: voice.status === "conversation",
				busy:
					!context ||
					Boolean(pending) ||
					(voice.active &&
						voice.status !== "conversation" &&
						voice.status !== "transferred"),
			};
		},
		async depart(channel) {
			let reservation: object | undefined;
			let connection: ReturnType<typeof startVoiceDeparture> | undefined;
			try {
				const reserved = reserve();
				reservation = reserved.reservation;
				const { ctx } = reserved;
				const previous = incoming;
				const captured = voice.captureHandoffAudio();
				let established = false;
				connection = startVoiceDeparture({
					channel,
					captured,
					waitForSettled: (signal) => waitForSettled(ctx, signal),
					onReleased(controls) {
						previous?.forwardTo(controls);
						if (incoming === previous) incoming = undefined;
					},
					onClosed(error) {
						if (connection) connections.delete(connection);
						if (established && context === ctx)
							ctx.ui.notify(error.message, "warning");
					},
				});
				connections.add(connection);
				await connection.completion;
				established = true;
			} catch (error) {
				if (connection) connections.delete(connection);
				rejectChannel(channel, error);
				throw error;
			} finally {
				if (pending === reservation) pending = undefined;
			}
		},
		async arrive(channel, continuity) {
			let reservation: object | undefined;
			let connection: IncomingVoiceHandoff | undefined;
			try {
				if (Buffer.byteLength(continuity) > 64 * 1024)
					throw new Error("Voice arrival context is too large");
				const reserved = reserve();
				reservation = reserved.reservation;
				const { ctx } = reserved;
				let established = false;
				connection = startVoiceArrival({
					pi,
					ctx,
					voice,
					config: options.getConfig(),
					channel,
					continuity,
					onClosed(error) {
						if (connection) connections.delete(connection);
						if (incoming === connection) incoming = undefined;
						if (established && context === ctx)
							ctx.ui.notify(error.message, "warning");
					},
				});
				connections.add(connection);
				incoming = connection;
				await connection.completion;
				established = true;
			} catch (error) {
				if (connection) connections.delete(connection);
				rejectChannel(channel, error);
				throw error;
			} finally {
				if (pending === reservation) pending = undefined;
			}
		},
	};
	pi.events.on(VOICE_HANDOFF_REQUEST, (request) => {
		if (isVoiceHandoffRequest(request)) request.accept(service);
	});
	const reset = () => {
		context = undefined;
		incoming = undefined;
		pending = undefined;
		for (const connection of connections) connection.close();
		connections.clear();
	};
	pi.on("session_start", (_event, ctx) => {
		reset();
		context = ctx;
	});
	pi.on("session_shutdown", () => reset());
	pi.on("agent_settled", () => {
		// Other extensions' settlement handlers finish before source audio moves.
		setImmediate(() => {
			for (const settled of settledListeners) settled();
		});
	});
	const publish = (event: ExtensionEvent) => {
		if (event.type === "turn_end") {
			// Pi's boundary preview can contain the entire model context.
			incoming?.publish(event.type, {
				type: event.type,
				turnIndex: event.turnIndex,
				message: event.message,
				toolResults: event.toolResults,
				messageEntryId: event.messageEntryId,
				toolResultEntryIds: event.toolResultEntryIds,
				outcome: event.outcome,
			});
		} else incoming?.publish(event.type, event);
	};
	pi.on("session_info_changed", publish);
	pi.on("message_start", publish);
	pi.on("message_update", publish);
	pi.on("message_end", publish);
	pi.on("input", publish);
	pi.on("agent_start", publish);
	pi.on("agent_settled", publish);
	pi.on("agent_end", publish);
	pi.on("ui_prompt_start", publish);
	pi.on("ui_prompt_end", publish);
	pi.on("tool_execution_start", publish);
	pi.on("tool_execution_update", publish);
	pi.on("tool_execution_end", publish);
	pi.on("session_compact", publish);
	pi.on("turn_start", publish);
	pi.on("turn_end", publish);
}
