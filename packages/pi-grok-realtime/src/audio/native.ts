import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { audioEnvironment, audioHelperPath } from "./helper.ts";

interface AudioCallbacks {
	onAudio(pcm: Buffer): void;
	onError(error: Error): void;
}

interface Session {
	process: ChildProcessWithoutNullStreams;
	callbacks: AudioCallbacks;
	phase: "starting" | "running" | "closing";
	resolveStart: () => void;
	rejectStart: (error: Error) => void;
	exited: Promise<void>;
	resolveExit: () => void;
	buffer: Buffer;
	stderr: string;
	errorReported: boolean;
	drain?: {
		id: number;
		promise: Promise<void>;
		resolve: () => void;
		reject: (error: Error) => void;
	};
}

const MAX_FRAME_PCM = 0xfffffffe;

/** Local full-duplex 24kHz mono signed i16 LE audio; transport-independent. */
export class NativeAudio {
	private session: Session | undefined;
	private muted = false;
	private epoch = 0;
	private drainId = 0;

	private readonly devices: { microphone?: string; speaker?: string };

	constructor(devices: { microphone?: string; speaker?: string } = {}) {
		this.devices = devices;
	}

	async start(
		callbacks: AudioCallbacks,
		options: { inputDevice?: string; outputDevice?: string } = {},
	): Promise<void> {
		if (this.session) throw new Error("Native audio is already started");
		const inputDevice = options.inputDevice ?? this.devices.microphone ?? "";
		const outputDevice = options.outputDevice ?? this.devices.speaker ?? "";
		for (const device of [inputDevice, outputDevice]) {
			if (
				device !== undefined &&
				(typeof device !== "string" || device.includes("\0"))
			) {
				throw new Error("Invalid audio device name");
			}
		}
		const child = spawn(audioHelperPath(), [inputDevice, outputDevice], {
			stdio: "pipe",
			env: audioEnvironment(),
		});
		let resolveStart!: () => void;
		let rejectStart!: (error: Error) => void;
		const started = new Promise<void>((resolve, reject) => {
			resolveStart = resolve;
			rejectStart = reject;
		});
		let resolveExit!: () => void;
		const exited = new Promise<void>((resolve) => {
			resolveExit = resolve;
		});
		const session: Session = {
			process: child,
			callbacks,
			phase: "starting",
			resolveStart,
			rejectStart,
			exited,
			resolveExit,
			buffer: Buffer.alloc(0),
			stderr: "",
			errorReported: false,
		};
		this.session = session;
		child.stdout.on("data", (chunk: Buffer) => {
			try {
				this.receive(session, chunk);
			} catch (error) {
				this.fail(
					session,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			session.stderr = session.stderr + chunk.toString("utf8");
		});
		child.on("error", (error) => this.fail(session, error));
		child.stdin.on("error", (error) => this.fail(session, error));
		child.stdout.on("error", (error) => this.fail(session, error));
		child.stderr.on("error", (error) => this.fail(session, error));
		child.once("close", (code, signal) => {
			if (session.phase !== "closing") {
				this.fail(
					session,
					new Error(
						session.stderr.trim() || `Native audio stopped (${signal ?? code})`,
					),
				);
			}
			if (this.session === session) this.session = undefined;
			session.resolveExit();
		});
		try {
			await started;
		} catch (error) {
			await this.close();
			throw error;
		}
	}

	play(pcm: Buffer): void {
		const session = this.session;
		if (!session || session.phase !== "running")
			throw new Error("Native audio is not running");
		if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0)
			throw new Error("Audio must be mono i16 LE PCM");
		for (let offset = 0; offset < pcm.length; offset += MAX_FRAME_PCM)
			this.send(session, "P", pcm.subarray(offset, offset + MAX_FRAME_PCM));
	}

	clear(): void {
		const session = this.session;
		if (session) this.finishDrain(session);
		if (session?.phase === "running") this.send(session, "C");
	}

	drain(): Promise<void> {
		const session = this.session;
		if (!session || session.phase !== "running") return Promise.resolve();
		if (session.drain) return session.drain.promise;
		const id = (this.drainId = (this.drainId + 1) >>> 0);
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<void>((done, failed) => {
			resolve = done;
			reject = failed;
		});
		session.drain = {
			id,
			promise,
			resolve,
			reject,
		};
		const payload = Buffer.alloc(4);
		payload.writeUInt32LE(id);
		this.send(session, "D", payload);
		return promise;
	}

	private finishDrain(session: Session, error?: Error): void {
		if (!session.drain) return;
		if (error) session.drain.reject(error);
		else session.drain.resolve();
		delete session.drain;
	}

	setMuted(muted: boolean): void {
		if (muted === this.muted) return;
		this.muted = muted;
		this.epoch = (this.epoch + 1) >>> 0;
		const session = this.session;
		if (session?.phase === "running") this.sendMute(session);
	}

	async close(): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.finishDrain(session);
		if (session.phase !== "closing") {
			session.rejectStart(new Error("Native audio startup cancelled"));
			session.phase = "closing";
			session.process.kill("SIGKILL");
		}
		await session.exited;
	}

	private sendMute(session: Session): void {
		const payload = Buffer.alloc(5);
		payload.writeUInt32LE(this.epoch);
		payload[4] = this.muted ? 1 : 0;
		this.send(session, "M", payload);
	}

	private send(
		session: Session,
		tag: string,
		payload: Buffer = Buffer.alloc(0),
	): void {
		if (session.phase === "closing") return;

		try {
			const header = Buffer.allocUnsafe(5);
			header[0] = tag.charCodeAt(0);
			header.writeUInt32LE(payload.length, 1);
			// Node queues pending writes; false signals backlog, not failure.
			session.process.stdin.write(header);
			if (payload.length) session.process.stdin.write(payload);
		} catch (error) {
			this.fail(
				session,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private receive(session: Session, chunk: Buffer): void {
		if (session.phase === "closing") return;

		session.buffer = Buffer.concat([session.buffer, chunk]);
		while (session.buffer.length >= 5) {
			const tag = session.buffer[0];
			const length = session.buffer.readUInt32LE(1);
			if (
				!(
					(tag === 82 && length === 0) ||
					(tag === 65 && length === 964) ||
					(tag === 68 && length === 4)
				)
			) {
				this.fail(session, new Error("Invalid native audio response"));
				return;
			}
			if (session.buffer.length < length + 5) return;
			const payload = session.buffer.subarray(5, length + 5);
			session.buffer = session.buffer.subarray(length + 5);
			if (tag === 68) {
				if (session.drain?.id === payload.readUInt32LE(0))
					this.finishDrain(session);
			} else if (tag === 82) {
				if (session.phase !== "starting") {
					this.fail(session, new Error("Unexpected native audio readiness"));
					return;
				}
				this.sendMute(session);
				if (session.process.killed) return;
				session.phase = "running";
				session.resolveStart();
			} else if (
				session.phase === "running" &&
				!this.muted &&
				payload.readUInt32LE(0) === this.epoch
			) {
				try {
					session.callbacks.onAudio(Buffer.from(payload.subarray(4)));
				} catch (error) {
					this.fail(
						session,
						error instanceof Error ? error : new Error(String(error)),
					);
					return;
				}
			}
			if (session.process.killed) return;
		}
	}

	private fail(session: Session, error: Error): void {
		if (session.phase === "closing") return;
		session.rejectStart(error);
		this.finishDrain(session, error);
		void this.close();
		if (!session.errorReported) {
			session.errorReported = true;
			session.callbacks.onError(error);
		}
	}
}
