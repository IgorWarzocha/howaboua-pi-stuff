import { CodeModeHostProcess } from "./host-process.js";
import { type HostMessage, parseHostMessage } from "./host-protocol.js";

type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onValue?: ((value: unknown) => void) | undefined;
};

type HostConnectionOptions = {
	binary: string;
	onMessage: (message: HostMessage) => void;
	onFailure: (error: Error) => void;
};

export class CodeModeHostConnection {
	private readonly process: CodeModeHostProcess;
	private readonly onMessage: (message: HostMessage) => void;
	private readonly onFailure: (error: Error) => void;
	private requestId = 0;
	private ready: Promise<void> | undefined;
	private pending = new Map<number, Pending>();
	private initial = new Map<number, Pending>();

	constructor(options: HostConnectionOptions) {
		this.onMessage = options.onMessage;
		this.onFailure = options.onFailure;
		this.process = new CodeModeHostProcess({
			binary: options.binary,
			onMessage: (message) => this.handleMessage(parseHostMessage(message)),
			onFailure: (error) => this.failAll(error),
		});
	}

	get running(): boolean {
		return this.process.running;
	}

	nextRequestId(): number {
		return ++this.requestId;
	}

	async start(): Promise<void> {
		if (this.ready) return this.ready;
		const ready = this.startProcess();
		this.ready = ready;
		try {
			await ready;
		} catch (error) {
			this.failAll(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	private async startProcess(): Promise<void> {
		this.process.start();
		const handshake = new Promise<void>((resolve, reject) => {
			this.pending.set(0, { resolve: () => resolve(), reject });
		});
		this.send({
			type: "connection/hello",
			supportedVersions: [1],
			requiredCapabilities: [],
			optionalCapabilities: [],
		});
		await handshake;
	}

	request(
		request: Record<string, unknown>,
		onValue?: (value: unknown) => void,
	): Promise<unknown> {
		return this.requestWithId(this.nextRequestId(), request, onValue);
	}

	requestWithId(
		id: number,
		request: Record<string, unknown>,
		onValue?: (value: unknown) => void,
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, onValue });
			try {
				this.send({ type: "operation/request", id, request });
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	expectInitial(id: number): Promise<unknown> {
		return new Promise((resolve, reject) => {
			this.initial.set(id, { resolve, reject });
		});
	}

	send(message: unknown): void {
		this.process.send(message);
	}

	rejectOperation(id: number, error: Error): void {
		const pending = this.pending.get(id);
		this.pending.delete(id);
		pending?.reject(error);
		const initial = this.initial.get(id);
		this.initial.delete(id);
		initial?.reject(error);
	}

	close(error: Error): void {
		this.failAll(error);
	}

	private handleMessage(message: HostMessage): void {
		if (message.type === "connection/ready") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.resolve(undefined);
			return;
		}
		if (message.type === "connection/rejected") {
			const pending = this.pending.get(0);
			this.pending.delete(0);
			pending?.reject(
				new Error(
					`Code-mode handshake rejected: ${JSON.stringify(message.reason)}`,
				),
			);
			return;
		}
		if (message.type === "operation/response") {
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error") {
				pending.reject(new Error(message.result.message));
				return;
			}
			const value = message.result.value;
			pending.onValue?.(value);
			pending.resolve(value);
			return;
		}
		if (message.type === "execute/initialResponse") {
			const pending = this.initial.get(message.id);
			this.initial.delete(message.id);
			if (!pending) return;
			if (message.result.status === "error")
				pending.reject(new Error(message.result.message));
			else pending.resolve(message.result.value);
			return;
		}
		this.onMessage(message);
	}

	private failAll(error: Error): void {
		for (const pending of [...this.pending.values(), ...this.initial.values()])
			pending.reject(error);
		this.pending.clear();
		this.initial.clear();
		this.ready = undefined;
		this.process.kill();
		this.onFailure(error);
	}
}
