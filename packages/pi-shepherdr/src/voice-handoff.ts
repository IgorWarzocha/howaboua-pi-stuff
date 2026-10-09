import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { recordContextBriefing } from "@howaboua/pi-agent-board/integration";
import { voiceFocusContinuity, voiceFocusReport } from "./messages.js";
import { registerFocusChannelReceiver } from "./peer-channel.js";
import type { FocusRequest, PaneInfo, PeerChannel } from "./types.js";

const PROTOCOL = "@howaboua/pi/voice-handoff/v1";
const REPORT = "herdr-voice-focus-report";

// Optional event service contract; no dependency on either voice extension.
interface VoiceService {
	protocol: typeof PROTOCOL;
	priority: number;
	audioTransport?: "webrtc" | "pcm24";
	status(): { active: boolean; busy: boolean };
	depart(channel: PeerChannel): Promise<void>;
	arrive(channel: PeerChannel, continuity: string): Promise<void>;
}

function voiceServices(pi: ExtensionAPI): VoiceService[] {
	const services = new Set<VoiceService>();
	pi.events.emit(`${PROTOCOL}/request`, {
		protocol: PROTOCOL,
		accept(service: VoiceService) {
			if (
				service?.protocol === PROTOCOL &&
				Number.isFinite(service.priority) &&
				(service.audioTransport === undefined ||
					service.audioTransport === "webrtc" ||
					service.audioTransport === "pcm24") &&
				typeof service.status === "function" &&
				typeof service.depart === "function" &&
				typeof service.arrive === "function"
			)
				services.add(service);
		},
	});
	return [...services];
}

export function activeVoiceService(pi: ExtensionAPI): VoiceService {
	const active = voiceServices(pi).filter((service) => service.status().active);
	if (active.length !== 1 || active[0]!.status().busy)
		throw new Error(
			"Voice transfer needs exactly one active, available voice provider in the source session; use voice:false for text-only focus",
		);
	return active[0]!;
}

async function passiveReport(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	sessionFile: string | undefined,
	side: "source" | "destination",
	target: string,
	error?: unknown,
): Promise<void> {
	const content = voiceFocusReport(side, target, error);
	if (ctx.sessionManager.getSessionFile() === sessionFile) {
		pi.appendEntry(REPORT, {
			content,
			side,
			target,
			status: error === undefined ? "active" : "failed",
		});
		await recordContextBriefing(
			pi,
			ctx,
			REPORT,
			randomUUID(),
			async () => content,
		);
	}
	ctx.ui.notify(content, error === undefined ? "info" : "error");
}

export function observeVoiceTransfer(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	completion: Promise<void>,
	channel: PeerChannel,
	side: "source" | "destination",
	target: string,
): void {
	const sessionFile = ctx.sessionManager.getSessionFile();
	void completion
		.then(
			() => passiveReport(pi, ctx, sessionFile, side, target),
			(error: unknown) => {
				try {
					channel.close();
				} catch (closeError) {
					ctx.ui.notify(
						`Voice transfer cleanup failed: ${String(closeError)}`,
						"error",
					);
				}
				return passiveReport(
					pi,
					ctx,
					sessionFile,
					side,
					target,
					error instanceof Error ? error : new Error(String(error)),
				);
			},
		)
		.catch((error: unknown) =>
			ctx.ui.notify(
				`Voice transfer report could not be saved: ${String(error)}`,
				"error",
			),
		);
}

export function registerVoiceFocusReceiver(
	pi: ExtensionAPI,
	focus: (
		ctx: ExtensionContext,
		pane: PaneInfo,
		request: FocusRequest,
	) => Promise<void>,
): void {
	registerFocusChannelReceiver(pi, async (channel, request, ctx, pane) => {
		if (request.voice !== true)
			throw new Error("Voice channel requires voice:true");
		const service = voiceServices(pi)
			.filter((candidate) => {
				const status = candidate.status();
				return (
					!status.active &&
					!status.busy &&
					(candidate.audioTransport ?? "webrtc") ===
						(request.voiceAudioTransport ?? "webrtc")
				);
			})
			.sort((a, b) => b.priority - a.priority)[0];
		if (!service)
			throw new Error(
				"Destination has no available voice provider compatible with the current call; choose another session or use voice:false for text-only focus",
			);
		// arrive reserves synchronously; do not await replacement startup or source
		// settlement during admission. Attach rejection handling immediately.
		const completion = service.arrive(channel, voiceFocusContinuity(request));
		const outcome = completion.then(
			() => ({ ok: true as const }),
			(error: unknown) => ({ ok: false as const, error }),
		);
		try {
			await focus(ctx, pane, request);
		} catch (error) {
			try {
				channel.close();
			} catch (closeError) {
				ctx.ui.notify(
					`Voice transfer cleanup failed: ${String(closeError)}`,
					"error",
				);
			}
			throw error;
		}
		observeVoiceTransfer(
			pi,
			ctx,
			outcome.then((result) => {
				if (!result.ok) throw result.error;
			}),
			channel,
			"destination",
			pane.pane_id,
		);
	});
}
