import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// Custom kickoffs skip input hooks. Rollover must precede native busy reservation,
// because Tree navigation and compaction cannot run inside before_agent_start.
export const CUSTOM_TURN_ADMISSION_CHANNEL =
	"pi-notes-compaction:custom-turn-admission:v1";
export interface CustomTurnAdmission {
	protocol: 1;
	ctx: ExtensionContext;
	preparation?: Promise<void>;
}

export function admitCustomTurn(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> | undefined {
	const request: CustomTurnAdmission = { protocol: 1, ctx };
	pi.events.emit(CUSTOM_TURN_ADMISSION_CHANNEL, request);
	return request.preparation;
}
