import type { JupyterConnectionInfo } from "../jupyter-connection.ts";
import { JupyterSocket } from "../jupyter-socket.ts";
import { createJupyterMessage, decodeJupyterMessage, encodeJupyterMessage, type JupyterMessage } from "../jupyter-wire.ts";
import { withNotebookRecoveryGuidance } from "../runtime-health.ts";

interface ShellReplyWaiter {
	resolve(message: JupyterMessage): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout> | undefined;
	abort?: (() => void) | undefined;
}

export class JupyterShellChannel {
	private shell: JupyterSocket | undefined;
	private readonly connection: JupyterConnectionInfo;
	private readonly session: string;
	private readonly shellReplies = new Map<string, ShellReplyWaiter>();
	private readonly onFailure: (error: Error) => void;
	private readonly readStderr: () => string;
	pump: Promise<void> | undefined;

	constructor(connection: JupyterConnectionInfo, session: string, onFailure: (error: Error) => void, readStderr: () => string) {
		this.connection = connection;
		this.session = session;
		this.onFailure = onFailure;
		this.readStderr = readStderr;
		this.shell = new JupyterSocket("DEALER", connection.shell_port);
	}
	connect(signal?: AbortSignal): Promise<void> { return this.shell!.connect(signal); }
	startPump(): void { this.pump = this.runShellPump(this.shell!, this.connection); }
	request(type: string, content: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<JupyterMessage> {
		if (!this.shell) throw new Error(withNotebookRecoveryGuidance("Notebook runtime is disconnected"));
		const request = createJupyterMessage(type, content, this.session);
		return this.sendShellRequest(request, timeoutMs, type, signal);
	}
	close(): void {
		const shell = this.shell;
		this.shell = undefined;
		for (const waiter of this.shellReplies.values()) {
			if (waiter.timer) clearTimeout(waiter.timer);
			waiter.reject(new Error(withNotebookRecoveryGuidance("Notebook runtime disconnected")));
		}
		this.shellReplies.clear();
		shell?.close();
	}

	async sendShellRequest(
		request: JupyterMessage,
		timeoutMs?: number,
		requestType = "request",
		signal?: AbortSignal,
	): Promise<JupyterMessage> {
		const shell = this.shell;
		const connection = this.connection;
		if (!shell || !connection) throw new Error(withNotebookRecoveryGuidance("Notebook runtime is disconnected"));
		const requestId = request.header.msg_id;
		if (this.shellReplies.has(requestId)) throw new Error(withNotebookRecoveryGuidance("Notebook operation could not be started"));
		let waiter!: ShellReplyWaiter;
		const reply = new Promise<JupyterMessage>((resolve, reject) => {
			waiter = { resolve, reject };
		});
		if (timeoutMs !== undefined) {
			waiter.timer = setTimeout(() => {
				if (this.shellReplies.get(requestId) !== waiter) return;
				this.shellReplies.delete(requestId);
				waiter.reject(new Error(withNotebookRecoveryGuidance(`Notebook runtime did not respond within ${timeoutMs}ms`), { cause: new Error(`${requestType}\n${this.readStderr()}`) }));
			}, timeoutMs);
		}
		if (signal) {
			waiter.abort = () => {
				if (this.shellReplies.get(requestId) !== waiter) return;
				this.shellReplies.delete(requestId);
				if (waiter.timer) clearTimeout(waiter.timer);
				waiter.reject(signal.reason instanceof Error ? signal.reason : new Error("Deno Jupyter request aborted"));
			};
			signal.addEventListener("abort", waiter.abort, { once: true });
		}
		this.shellReplies.set(requestId, waiter);
		try {
			signal?.throwIfAborted();
			const [, response] = await Promise.all([shell.send(encodeJupyterMessage(request, connection.key)), reply]);
			return response;
		} catch (error) {
			if (this.shellReplies.get(requestId) === waiter) this.shellReplies.delete(requestId);
			if (waiter.timer) clearTimeout(waiter.timer);
			throw error;
		} finally {
			if (waiter.abort) signal?.removeEventListener("abort", waiter.abort);
		}
	}

	private async runShellPump(socket: JupyterSocket, connection: JupyterConnectionInfo): Promise<void> {
		try {
			for await (const frames of socket) {
				const message = decodeJupyterMessage([...frames] as Buffer[], connection.key);
				const requestId = message?.parent_header["msg_id"];
				if (typeof requestId !== "string") continue;
				const waiter = this.shellReplies.get(requestId);
				if (!waiter) continue;
				this.shellReplies.delete(requestId);
				if (waiter.timer) clearTimeout(waiter.timer);
				waiter.resolve(message!);
			}
		} catch (error) {
			if (this.shell === socket) this.onFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

export async function withJupyterTimeout<T>(pending: Promise<T>, timeoutMs: number, timeoutError: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(timeoutError()), timeoutMs);
		timer.unref?.();
	});
	try {
		return await Promise.race([pending, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
