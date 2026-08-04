import { randomUUID } from "node:crypto";
import { CodeModeHostConnection } from "./host-connection.js";
import type { HostMessage } from "./host-protocol.js";

const DEFAULT_SHUTDOWN_GRACE_MS = 250;

type HostSessionOptions = {
	binary: string;
	shutdownGraceMs?: number | undefined;
	onMessage: (message: HostMessage) => void;
	onFailure: (error: Error) => void;
};

export class CodeModeHostSession {
	readonly id = randomUUID();
	private readonly connection: CodeModeHostConnection;
	private readonly shutdownGraceMs: number;
	private readonly onFailure: (error: Error) => void;
	private ready: Promise<void> | undefined;

	constructor(options: HostSessionOptions) {
		this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
		this.onFailure = options.onFailure;
		this.connection = new CodeModeHostConnection({
			binary: options.binary,
			onMessage: options.onMessage,
			onFailure: (error) => {
				this.ready = undefined;
				this.onFailure(error);
			},
		});
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		const ready = this.startSession();
		this.ready = ready;
		try {
			await ready;
		} catch (error) {
			this.connection.close(toError(error));
			throw error;
		}
	}

	private async startSession(): Promise<void> {
		await this.connection.start();
		await this.connection.request({
			method: "session/open",
			sessionId: this.id,
		});
	}

	nextRequestId(): number {
		return this.connection.nextRequestId();
	}

	expectInitial(id: number): Promise<unknown> {
		return this.connection.expectInitial(id);
	}

	requestWithId(
		id: number,
		request: Record<string, unknown>,
		onValue?: (value: unknown) => void,
	): Promise<unknown> {
		return this.connection.requestWithId(id, request, onValue);
	}

	send(message: unknown): void {
		this.connection.send(message);
	}

	rejectOperation(id: number, error: Error): void {
		this.connection.rejectOperation(id, error);
	}

	async shutdown(): Promise<void> {
		if (!this.connection.running) return;
		try {
			await Promise.race([
				this.connection.request({
					method: "session/shutdown",
					sessionId: this.id,
				}),
				shutdownDeadline(this.shutdownGraceMs),
			]);
		} catch {
			// Process teardown below is authoritative.
		}
		this.connection.close(new Error("Code-mode host shut down"));
	}
}

function shutdownDeadline(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
