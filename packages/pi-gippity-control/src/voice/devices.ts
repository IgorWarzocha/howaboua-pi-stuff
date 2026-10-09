import { VoiceHelperClient } from "./helper.ts";
import type { VoiceHelperEvent } from "./helper-protocol.ts";

type VoiceDevice = Extract<
	VoiceHelperEvent,
	{ type: "devices" }
>["inputs"][number];

/** Device enumeration never starts capture or playback. */
export async function listNativeAudioDevices(
	signal: AbortSignal,
): Promise<{ inputs: VoiceDevice[]; outputs: VoiceDevice[] }> {
	const helper = new VoiceHelperClient();
	const result = Promise.withResolvers<{
		inputs: VoiceDevice[];
		outputs: VoiceDevice[];
	}>();
	const removeEvent = helper.onEvent((event) => {
		if (event.type === "devices") result.resolve(event);
		else if (event.type === "error") result.reject(new Error(event.message));
	});
	const removeExit = helper.onExit((error) => result.reject(error));
	const abort = () => {
		result.reject(new Error("Device discovery cancelled"));
		void helper.close();
	};
	const timeout = setTimeout(
		() => result.reject(new Error("Audio device discovery timed out")),
		5_000,
	);
	signal.addEventListener("abort", abort, { once: true });
	// Observe discovery failures while helper startup is still pending.
	void result.promise.catch(() => {});
	let started = false;
	try {
		signal.throwIfAborted();
		await helper.start();
		started = true;
		signal.throwIfAborted();
		helper.send({ type: "list_devices" });
		return await result.promise;
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (signal.aborted) throw error;
		if (message === "Audio device discovery timed out") throw error;
		if (!started) {
			const reason = message.startsWith("Codex voice helper is not bundled")
				? `Native audio is unavailable for ${process.platform}-${process.arch}`
				: "Native audio could not start on this system";
			throw new Error(
				`${reason}. Install GipPity with a compatible voice helper or build its voice helper locally, then /reload`,
			);
		}
		throw new Error(
			"Audio device discovery failed. Check system audio devices and permissions, then reopen to retry",
		);
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", abort);
		removeEvent();
		removeExit();
		await helper.close();
	}
}
