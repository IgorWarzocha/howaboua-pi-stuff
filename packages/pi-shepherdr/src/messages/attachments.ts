import type { BoardBinding } from "@howaboua/pi-agent-board/integration";

export function attachmentMessage(
	controllerContextAgent?: string,
	boardAgent?: string,
) {
	return {
		customType: "herdr-agent-attachment",
		content: [
			...(controllerContextAgent
				? [
						`Controller notes/history: ${controllerContextAgent}; own context unchanged`,
					]
				: []),
			...(boardAgent ? [`Shared board: ${boardAgent}`] : []),
		].join("\n"),
		display: true,
	};
}

export function detachmentMessage(
	controllerContextAgent?: string,
	board?: BoardBinding,
) {
	return {
		customType: "herdr-agent-detachment",
		content: [
			...(controllerContextAgent
				? [
						`Detached controller: ${controllerContextAgent}; checkpoints read-only, history unavailable; own context unchanged`,
					]
				: []),
			...(board
				? [`Board restored: ${board.boardId} as ${board.agentName}`]
				: []),
		].join("\n"),
		display: true,
	};
}
