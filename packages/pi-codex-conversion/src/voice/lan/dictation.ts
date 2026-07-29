import type { CodexVoiceAuth } from "../auth.ts";
import { CANCELLED, interruptible } from "../cancellation.ts";
import { CodexDictationTranscriber } from "../dictation/transcriber.ts";

export class LanVoiceDictation {
	private readonly resolveAuth: () => Promise<CodexVoiceAuth>;
	private readonly onError: (clientId: string, error: Error) => void;
	private current: { clientId: string; transcriber: CodexDictationTranscriber; startAbort: AbortController } | undefined;
	private finishing: { clientId: string; transcriber: CodexDictationTranscriber } | undefined;

	constructor(options: {
		resolveAuth(): Promise<CodexVoiceAuth>;
		onError(clientId: string, error: Error): void;
	}) {
		this.resolveAuth = options.resolveAuth;
		this.onError = options.onError;
	}

	async start(clientId: string): Promise<void> {
		if (this.current?.clientId === clientId) return;
		if (this.current) await this.finish(this.current.clientId);
		const startAbort = new AbortController();
		let transcriber!: CodexDictationTranscriber;
		transcriber = new CodexDictationTranscriber({
			onError: (error) => {
				if (this.current?.transcriber === transcriber) this.current = undefined;
				this.onError(clientId, error);
			},
			onStatus: () => {},
		});
		const current = { clientId, transcriber, startAbort };
		this.current = current;
		try {
			const auth = await interruptible(this.resolveAuth(), startAbort.signal);
			if (auth === CANCELLED) throw new Error("Codex dictation start was cancelled");
			await transcriber.start(auth);
			if (this.current !== current) throw new Error("Codex dictation start was cancelled");
		} catch (error) {
			if (this.current?.transcriber === transcriber) this.current = undefined;
			await transcriber.close();
			throw error;
		}
	}

	append(clientId: string, pcm: Buffer): void {
		if (this.current?.clientId !== clientId) return;
		this.current.transcriber.append(pcm);
	}

	async finish(clientId: string): Promise<string | undefined> {
		const current = this.current;
		if (!current || current.clientId !== clientId) return undefined;
		this.current = undefined;
		this.finishing = current;
		try {
			const transcript = await current.transcriber.finish();
			if (this.finishing !== current) return undefined;
			return transcript;
		} finally {
			if (this.finishing === current) this.finishing = undefined;
		}
	}

	async cancel(clientId: string): Promise<void> {
		const current = this.current?.clientId === clientId ? this.current : undefined;
		const session = current ?? (this.finishing?.clientId === clientId ? this.finishing : undefined);
		if (!session) return;
		if (this.current === session) this.current = undefined;
		if (this.finishing === session) this.finishing = undefined;
		current?.startAbort.abort();
		await session.transcriber.close();
	}

	async close(): Promise<void> {
		const current = this.current;
		const finishing = this.finishing;
		this.current = undefined;
		this.finishing = undefined;
		current?.startAbort.abort();
		await current?.transcriber.close();
		if (finishing?.transcriber !== current?.transcriber) await finishing?.transcriber.close();
	}
}
