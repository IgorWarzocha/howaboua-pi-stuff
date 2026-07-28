import type { CodexVoiceAuth } from "../auth.ts";
import { CodexDictationTranscriber } from "../dictation/transcriber.ts";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";

export class LanVoiceDictation {
	private readonly resolveAuth: () => Promise<CodexVoiceAuth>;
	private readonly diagnostics: LanVoiceDiagnostics;
	private readonly onError: (clientId: string, error: Error) => void;
	private current: { clientId: string; transcriber: CodexDictationTranscriber } | undefined;
	private finishing: { clientId: string; transcriber: CodexDictationTranscriber } | undefined;

	constructor(options: {
		resolveAuth(): Promise<CodexVoiceAuth>;
		diagnostics: LanVoiceDiagnostics;
		onError(clientId: string, error: Error): void;
	}) {
		this.resolveAuth = options.resolveAuth;
		this.diagnostics = options.diagnostics;
		this.onError = options.onError;
	}

	async start(clientId: string): Promise<void> {
		if (this.current?.clientId === clientId) return;
		if (this.current) await this.finish(this.current.clientId);
		let transcriber!: CodexDictationTranscriber;
		transcriber = new CodexDictationTranscriber({
			onError: (error) => {
				if (this.current?.transcriber === transcriber) this.current = undefined;
				this.diagnostics.write("dictation", "error", { clientId, error });
				this.onError(clientId, error);
			},
			onStatus: (status) => this.diagnostics.write("dictation", "status", { clientId, status }),
		});
		this.current = { clientId, transcriber };
		this.diagnostics.write("dictation", "start", { clientId });
		try {
			await transcriber.start(await this.resolveAuth());
		} catch (error) {
			if (this.current?.transcriber === transcriber) this.current = undefined;
			await transcriber.close();
			throw error;
		}
	}

	append(clientId: string, pcm: Buffer): void {
		if (this.current?.clientId !== clientId) return;
		this.diagnostics.write("dictation", "audio", { clientId, bytes: pcm.byteLength });
		this.current.transcriber.append(pcm);
	}

	async finish(clientId: string): Promise<string | undefined> {
		const current = this.current;
		if (!current || current.clientId !== clientId) return undefined;
		this.current = undefined;
		this.finishing = current;
		this.diagnostics.write("dictation", "finish", { clientId });
		try {
			const transcript = await current.transcriber.finish();
			this.diagnostics.write("dictation", "complete", { clientId, transcript });
			return transcript;
		} finally {
			if (this.finishing === current) this.finishing = undefined;
		}
	}

	async cancel(clientId: string): Promise<void> {
		const session = this.current?.clientId === clientId
			? this.current
			: this.finishing?.clientId === clientId ? this.finishing : undefined;
		if (!session) return;
		if (this.current === session) this.current = undefined;
		if (this.finishing === session) this.finishing = undefined;
		this.diagnostics.write("dictation", "cancel", { clientId });
		await session.transcriber.close();
	}

	async close(): Promise<void> {
		const current = this.current;
		const finishing = this.finishing;
		this.current = undefined;
		this.finishing = undefined;
		await current?.transcriber.close();
		if (finishing?.transcriber !== current?.transcriber) await finishing?.transcriber.close();
	}
}
