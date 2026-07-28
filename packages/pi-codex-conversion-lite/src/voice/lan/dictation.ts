import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexVoiceAuth } from "../auth.ts";
import { CodexDictationTranscriber } from "../dictation/transcriber.ts";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";

export class LanVoiceDictation {
	private readonly ctx: ExtensionContext;
	private readonly diagnostics: LanVoiceDiagnostics;
	private readonly onError: (clientId: string, error: Error) => void;
	private current: { clientId: string; transcriber: CodexDictationTranscriber } | undefined;

	constructor(options: {
		ctx: ExtensionContext;
		diagnostics: LanVoiceDiagnostics;
		onError(clientId: string, error: Error): void;
	}) {
		this.ctx = options.ctx;
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
			await transcriber.start(await resolveCodexVoiceAuth(this.ctx));
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
		this.diagnostics.write("dictation", "finish", { clientId });
		const transcript = await current.transcriber.finish();
		this.diagnostics.write("dictation", "complete", { clientId, transcript });
		return transcript;
	}

	async close(): Promise<void> {
		const current = this.current;
		this.current = undefined;
		await current?.transcriber.close();
	}
}
