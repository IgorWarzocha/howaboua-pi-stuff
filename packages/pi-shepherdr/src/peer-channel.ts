import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FocusRequest, PaneInfo, PeerChannel } from "./types.js";

type Receiver = (
	channel: PeerChannel,
	request: FocusRequest,
	ctx: ExtensionContext,
	pane: PaneInfo,
) => Promise<void>;
const receivers = new WeakMap<ExtensionAPI, Receiver>();

/** Resolve after admission; the receiver owns the channel through call shutdown. */
export function registerFocusChannelReceiver(
	pi: ExtensionAPI,
	receiver: Receiver,
): () => void {
	if (receivers.has(pi))
		throw new Error("Focus channel receiver already registered");
	receivers.set(pi, receiver);
	return () => {
		if (receivers.get(pi) === receiver) receivers.delete(pi);
	};
}

export async function acceptFocusChannel(
	pi: ExtensionAPI,
	channel: PeerChannel,
	request: FocusRequest,
	ctx: ExtensionContext,
	pane: PaneInfo,
): Promise<void> {
	const receiver = receivers.get(pi);
	if (!receiver)
		throw new Error("Voice transfer is unavailable in the destination session");
	await receiver(channel, request, ctx, pane);
}
