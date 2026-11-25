import type { RealtimePeer } from "./peer.ts";

export class ApiLiveFinalizationError extends Error {}

/** Confirm the API has finalised the call before releasing the transport. */
export async function closeApiLiveSession(peer: RealtimePeer): Promise<void> {
	const result = Promise.withResolvers<void>();
	const removeEvent = peer.onEvent((event) => {
		if (
			event.type === "data" &&
			event.message &&
			typeof event.message === "object" &&
			"type" in event.message &&
			event.message.type === "session.closed"
		)
			result.resolve();
		else if (event.type === "error") result.reject(new Error(event.message));
	});
	const removeExit = peer.onExit((error) => result.reject(error));
	const timeout = setTimeout(
		() =>
			result.reject(new Error("Voice session finalisation was not confirmed")),
		5_000,
	);
	try {
		peer.sendData({ type: "session.close" });
		await result.promise;
	} catch (error) {
		throw new ApiLiveFinalizationError(
			`Voice ended, but final usage could not be confirmed. ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timeout);
		removeEvent();
		removeExit();
	}
}
