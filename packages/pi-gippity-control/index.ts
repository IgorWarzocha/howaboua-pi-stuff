import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGippityControl } from "./src/register.ts";

export {
	MAX_REALTIME_VOICE_PROMPT_BYTES,
	parseRealtimeVoicePrompt,
	REALTIME_VOICE_PROMPT_CHANNEL,
	type RealtimeVoicePromptReport,
	reportRealtimeVoicePrompt,
} from "./src/realtime-voice.ts";
export {
	type GippityRemoteAppProvider,
	type GippityRemoteAppRegistration,
	type GippityRemoteAppUpdate,
	registerGippityRemoteApp,
} from "./src/voice/lan/remote-app.ts";

export default function gippityControl(pi: ExtensionAPI): void {
	registerGippityControl(pi);
}
