import type { VoiceHandoffChannel } from "./handoff-contract.ts";

type Stage = "prepared" | "activate" | "active";
type RequestMethod =
	| "peer.start"
	| "peer.close"
	| "session.send"
	| "session.rpc";
export type HandoffNotification =
	| {
			type: "peer.command";
			generation: number;
			command: string;
			value: unknown;
	  }
	| { type: "peer.event"; generation: number; event: unknown }
	| { type: "session.mute"; muted: boolean }
	| { type: "session.event"; event: string; data: unknown };

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

interface HandoffHandlers {
	request(method: RequestMethod, value: unknown): Promise<unknown>;
	notification(message: HandoffNotification): void;
	closed(error: Error): void;
}

/** Call setup/control only. Audio stays on the original host's WebRTC peer. */
export class VoiceHandoffLink {
	private readonly pending = new Map<number, PendingRequest>();
	private readonly stages = new Map<Stage, unknown>();
	private readonly stageWaiters = new Map<Stage, PendingRequest>();
	private sequence = 0;
	private failure: Error | undefined;
	private readonly removeMessage: () => void;
	private readonly removeClose: () => void;
	private readonly channel: VoiceHandoffChannel;
	private readonly handlers: HandoffHandlers;

	constructor(channel: VoiceHandoffChannel, handlers: HandoffHandlers) {
		this.channel = channel;
		this.handlers = handlers;
		// Transport callbacks may replay already-buffered frames synchronously.
		this.removeMessage = channel.onMessage((message) => {
			try {
				this.receive(message);
			} catch (error) {
				this.fail(asError(error));
			}
		});
		this.removeClose = channel.onClose((error) => this.finish(error));
		if (this.failure) {
			this.removeMessage();
			this.removeClose();
		}
	}

	get closed(): boolean {
		return this.failure !== undefined;
	}

	request(method: RequestMethod, value?: unknown): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.pending.size >= 32)
			return Promise.reject(new Error("Too many pending voice controls"));
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				const error = new Error("Voice control did not respond");
				reject(error);
				this.fail(error);
			}, 30_000);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.send({ type: "request", id, method, value });
			} catch (error) {
				this.fail(asError(error));
			}
		});
	}

	notify(message: HandoffNotification): void {
		this.send(message);
	}
	stage(stage: Stage, value?: unknown): void {
		this.send({ type: "stage", stage, value });
	}

	waitFor(stage: Stage): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.stages.has(stage)) return Promise.resolve(this.stages.get(stage));
		if (this.stageWaiters.has(stage))
			return Promise.reject(new Error("Voice transfer stage already awaited"));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.stageWaiters.delete(stage);
				const error = new Error("Voice transfer did not finish preparing");
				reject(error);
				this.fail(error);
			}, 120_000);
			this.stageWaiters.set(stage, { resolve, reject, timer });
		});
	}

	close(): void {
		this.fail(new Error("Voice connection closed"));
	}

	fail(error: Error): void {
		if (this.failure) return;
		try {
			this.channel.send({
				type: "failure",
				message: error.message.slice(0, 4_000),
			});
		} catch {
			/* The local failure still owns cleanup if transport is already gone. */
		}
		this.finish(error);
		this.channel.close();
	}

	private send(message: unknown): void {
		if (this.failure) throw this.failure;
		try {
			this.channel.send(message);
		} catch (error) {
			this.fail(asError(error));
			throw error;
		}
	}

	private finish(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		this.removeMessage?.();
		this.removeClose?.();
		for (const pending of [
			...this.pending.values(),
			...this.stageWaiters.values(),
		]) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		this.stageWaiters.clear();
		this.handlers.closed(error);
	}

	private receive(value: unknown): void {
		if (this.failure) return;
		if (!isRecord(value)) throw new Error("Invalid voice transfer frame");
		if (value["type"] === "failure" && typeof value["message"] === "string") {
			this.finish(new Error(value["message"].slice(0, 4_000)));
			this.channel.close();
			return;
		}
		if (value["type"] === "stage" && isStage(value["stage"])) {
			this.stages.set(value["stage"], value["value"]);
			const waiter = this.stageWaiters.get(value["stage"]);
			if (waiter) {
				clearTimeout(waiter.timer);
				this.stageWaiters.delete(value["stage"]);
				waiter.resolve(value["value"]);
			}
			return;
		}
		if (
			(value["type"] === "request" || value["type"] === "reply") &&
			typeof value["id"] === "number" &&
			Number.isSafeInteger(value["id"]) &&
			value["id"] > 0
		) {
			const id = value["id"];
			if (value["type"] === "reply") {
				if (
					typeof value["ok"] !== "boolean" ||
					(!value["ok"] && typeof value["error"] !== "string")
				)
					throw new Error("Invalid voice control reply");
				const pending = this.pending.get(id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(id);
				if (value["ok"]) pending.resolve(value["value"]);
				else pending.reject(new Error(String(value["error"])));
				return;
			}
			const method = value["method"];
			if (!isRequestMethod(method))
				throw new Error("Invalid voice control request");
			void this.handlers
				.request(method, value["value"])
				.then(
					(result) => {
						if (!this.failure)
							this.send({ type: "reply", id, ok: true, value: result });
					},
					(error: unknown) => {
						if (!this.failure)
							this.send({
								type: "reply",
								id,
								ok: false,
								error: asError(error).message,
							});
					},
				)
				.catch((error: unknown) => this.fail(asError(error)));
			return;
		}
		const generation = value["generation"];
		const validGeneration =
			typeof generation === "number" &&
			Number.isSafeInteger(generation) &&
			generation > 0;
		if (
			value["type"] === "peer.command" &&
			typeof value["command"] === "string" &&
			validGeneration
		) {
			this.handlers.notification({
				type: "peer.command",
				generation,
				command: value["command"],
				value: value["value"],
			});
			return;
		}
		if (value["type"] === "peer.event" && validGeneration) {
			this.handlers.notification({
				type: "peer.event",
				generation,
				event: value["event"],
			});
			return;
		}
		if (
			value["type"] === "session.event" &&
			typeof value["event"] === "string" &&
			value["event"].length <= 64
		) {
			this.handlers.notification({
				type: "session.event",
				event: value["event"],
				data: value["data"],
			});
			return;
		}
		if (
			value["type"] === "session.mute" &&
			typeof value["muted"] === "boolean"
		) {
			this.handlers.notification({
				type: "session.mute",
				muted: value["muted"],
			});
			return;
		}
		throw new Error("Invalid voice transfer frame");
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isStage(value: unknown): value is Stage {
	return value === "prepared" || value === "activate" || value === "active";
}

function isRequestMethod(value: unknown): value is RequestMethod {
	return (
		value === "peer.start" ||
		value === "peer.close" ||
		value === "session.send" ||
		value === "session.rpc"
	);
}
