import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { RealtimeAudio } from "../audio.ts";
import { GrokSession } from "../session.ts";
import type { collectGrokTools } from "../tools.ts";
import type { GrokCall } from "./lifecycle.ts";
export interface GrokCallEffects {
	isCurrent(): boolean;
	working(): void;
	status(status: string): void;
	stop(): Promise<void>;
	lifecycle(ctx: ExtensionContext, state: "started" | "ended"): void;
}
export function createCallSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	audio: RealtimeAudio,
	tools: ReturnType<typeof collectGrokTools>,
	abort: AbortController,
	call: GrokCall,
	effects: GrokCallEffects,
): GrokSession {
	const diagnostic = call.diagnostic;
	return new GrokSession({
		diagnostic,
		nativeTool: (id, name, args) =>
			pi.appendEntry("grok-realtime-native-tool", {
				id,
				name,
				args,
			}),
		executeTool: (name, args, callId) =>
			tools.execute(name, args, { signal: abort.signal, ctx, callId }),
		audio: (pcm) => {
			if (effects.isCurrent()) audio.play(pcm);
		},
		audioDone: (responseId) => {
			// Mark the final render boundary for playback completion.
			const generation = call.playbackGeneration;
			return audio.drain().then(() =>
				diagnostic({
					response_id: responseId,
					type:
						generation === call.playbackGeneration && effects.isCurrent()
							? "playback.drained"
							: "playback.drain_interrupted",
				}),
			);
		},
		interrupt: () => {
			diagnostic({ type: "playback.cleared" });
			call.endGeneration++;
			call.playbackGeneration++;
			audio.clear();
		},
		endCall: () => {
			void call
				.finish()
				.catch((error) =>
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					),
				);
		},
		transcript: (role, text) =>
			pi.appendEntry("grok-realtime-transcript", { role, text }),
		task: (id, request) => {
			if (!effects.isCurrent())
				throw new Error("Voice call ended before the task was accepted");
			effects.working();
			pi.appendEntry("grok-realtime-delegation", { id, request });
			pi.sendUserMessage(
				request,
				ctx.isIdle() ? undefined : { deliverAs: "steer" },
			);
		},
		status: (status) => {
			if (effects.isCurrent()) effects.status(status);
		},
		error: (error) => {
			diagnostic({ type: "call.error", message: error.message });
			if (effects.isCurrent()) {
				ctx.ui.notify(error.message, "error");
				void effects.stop();
			}
		},
		disconnected: (error) => {
			if (effects.isCurrent()) void call.resume(error);
		},
	});
}
