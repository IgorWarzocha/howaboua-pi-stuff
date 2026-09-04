import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type TryCodexDeveloperMessage = (
	pi: ExtensionAPI,
	content: string,
	options: { deliverAs: "steer"; triggerTurn: true },
) => boolean;

export function createSteerDelivery(
	pi: ExtensionAPI,
	trySendCodexDeveloperMessage?: TryCodexDeveloperMessage,
): (message: string) => void {
	return (message) => {
		if (
			trySendCodexDeveloperMessage?.(pi, message, {
				deliverAs: "steer",
				triggerTurn: true,
			})
		)
			return;
		pi.sendUserMessage(message, { deliverAs: "steer" });
	};
}
