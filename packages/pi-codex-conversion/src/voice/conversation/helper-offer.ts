import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { VoiceHelperClient } from "../helper.ts";

const OFFER_TIMEOUT_MS = 15_000;

export async function startRealtimeOffer(
	helper: VoiceHelperClient,
	config: CodexConversionConfig,
	mode: "native" | "bridge",
): Promise<string> {
	await helper.start(config.tools.customRustBinariesDir);
	if (helper.protocolVersion !== 5) {
		const actualVersion = helper.protocolVersion ?? "unknown";
		await helper.close();
		throw new Error(`Incompatible Codex voice helper protocol ${actualVersion}; expected 5`);
	}
	const offer = Promise.withResolvers<string>();
	const removeEvent = helper.onEvent((event) => {
		if (event.type === "offer") offer.resolve(event.sdp);
		else if (event.type === "error") offer.reject(new Error(event.message));
	});
	const removeExit = helper.onExit((error) => offer.reject(error));
	const timeout = setTimeout(
		() =>
			offer.reject(new Error("Codex voice helper did not create an offer")),
		OFFER_TIMEOUT_MS,
	);
	helper.send(mode === "bridge" ? { type: "start_v3_bridge" } : {
		type: "start_v3",
		...(config.voice.inputDevice
			? { microphone: config.voice.inputDevice }
			: {}),
		...(config.voice.outputDevice
			? { speaker: config.voice.outputDevice }
			: {}),
	});
	return offer.promise.finally(() => {
		clearTimeout(timeout);
		removeEvent();
		removeExit();
	});
}
