import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { VoiceHelperClient } from "../helper.ts";

const OFFER_TIMEOUT_MS = 15_000;

export async function startRealtimeOffer(
	helper: VoiceHelperClient,
	config: CodexConversionConfig,
	mode: "native" | "bridge",
): Promise<string> {
	await helper.start(config.tools.customRustBinariesDir);
	if (helper.protocolVersion !== 8) {
		await helper.close();
		throw new Error("Voice could not start because its helper does not match this package. Rebuild or remove any voice-helper override in tools.customRustBinariesDir, or reinstall the package, then try starting voice again.");
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
