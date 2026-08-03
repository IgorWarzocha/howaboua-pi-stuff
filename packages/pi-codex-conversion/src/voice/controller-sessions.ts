import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "./auth.ts";
import type { RealtimeInitialMessageItem } from "./context.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CodexDictationSession } from "./dictation/session.ts";
import type { RealtimeVoiceTurn } from "./turns.ts";

interface SessionLifecycle<T> {
	stillAuthorizing(): boolean;
	onCreated(session: T): void;
	isCurrent(session: T): boolean;
	onActive(session: T): void;
	onError(session: T, error: Error): void;
	onStatus(status: string): void;
}

interface RealtimeSessionLifecycle extends SessionLifecycle<CodexRealtimeConversation> {
	onTurn(turn: RealtimeVoiceTurn): void;
	onUserTranscript(transcript: string): void;
	onTranscriptTail(transcript: string): void;
}

interface DictationSessionLifecycle extends SessionLifecycle<CodexDictationSession> {
	onTranscript(transcript: string): void;
}

export async function startControllerConversation(options: {
	auth: CodexVoiceAuth;
	config: CodexConversionConfig;
	instructions: string;
	initialItems?: RealtimeInitialMessageItem[] | undefined;
	peer?: CodexRealtimePeer | undefined;
	signal?: AbortSignal | undefined;
	lifecycle: RealtimeSessionLifecycle;
}): Promise<void> {
	if (options.signal?.aborted) { await options.peer?.close(); return; }
	const { CodexRealtimeConversation } = await import("./conversation/session.ts");
	if (!options.lifecycle.stillAuthorizing() || options.signal?.aborted) { await options.peer?.close(); return; }
	const realtimePeer = options.peer ?? new (await import("./conversation/native-peer.ts")).NativeCodexRealtimePeer();
	if (!options.lifecycle.stillAuthorizing() || options.signal?.aborted) { await realtimePeer.close(); return; }
	let session!: CodexRealtimeConversation;
	session = new CodexRealtimeConversation({
		onError: (error) => options.lifecycle.onError(session, error),
		onStatus: options.lifecycle.onStatus,
		onTurn: options.lifecycle.onTurn,
		onUserTranscript: options.lifecycle.onUserTranscript,
		onTranscriptTail: options.lifecycle.onTranscriptTail,
	}, realtimePeer);
	options.lifecycle.onCreated(session);
	if (options.signal?.aborted) { await session.close(); return; }
	const closeOnAbort = () => { void session.close(); };
	options.signal?.addEventListener("abort", closeOnAbort, { once: true });
	try {
		await session.start(options.auth, options.config, options.instructions, options.initialItems);
	} finally {
		options.signal?.removeEventListener("abort", closeOnAbort);
	}
	if (options.lifecycle.isCurrent(session)) options.lifecycle.onActive(session);
	else await session.close();
}

export async function startControllerDictation(options: {
	auth: CodexVoiceAuth;
	config: CodexConversionConfig;
	lifecycle: DictationSessionLifecycle;
}): Promise<void> {
	const { CodexDictationSession } = await import("./dictation/session.ts");
	if (!options.lifecycle.stillAuthorizing()) return;
	let session!: CodexDictationSession;
	session = new CodexDictationSession({
		onError: (error) => options.lifecycle.onError(session, error),
		onStatus: options.lifecycle.onStatus,
		onTranscript: options.lifecycle.onTranscript,
	});
	options.lifecycle.onCreated(session);
	await session.start(options.auth, options.config);
	if (options.lifecycle.isCurrent(session)) options.lifecycle.onActive(session);
	else await session.close();
}
