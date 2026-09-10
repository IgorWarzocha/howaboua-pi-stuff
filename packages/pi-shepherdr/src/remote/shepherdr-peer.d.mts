import type { PaneInfo } from "../types.js";

export const MAX_PEER_FRAME_BYTES: number;
export function peerInboxPath(sessionFile: string, terminalId: string): string;
export function sendPeerMessage(
	request: (method: string, params: object) => Promise<unknown>,
	expected: PaneInfo,
	text: string,
): Promise<void>;
