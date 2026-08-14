const LAN_REMOTE_PROTOCOL_VERSION = 1;
export const LAN_REMOTE_CLIENT_PATH = "/_gippity/client.js";
export const LAN_REMOTE_DISCOVERY_PATH = "/api/discovery";

export function createLanRemoteDiscovery(options: {
	customWebApp: boolean;
	customWebAppPath?: string | undefined;
	configPath: string;
}): Record<string, unknown> {
	return {
		name: "GipPity remote control",
		protocolVersion: LAN_REMOTE_PROTOCOL_VERSION,
		trustedNetwork: true,
		webApp: options.customWebApp
			? options.customWebAppPath
				? { mode: "custom", path: options.customWebAppPath }
				: { mode: "discovery" }
			: { mode: "bundled" },
		gettingStarted: {
			command: "/gippity create",
			configPath: options.configPath,
			appDirectory:
				"Create a static index.html with any CSS/JS/assets. GipPity hosts the directory; do not start another web server.",
			pwa: "Build an installable PWA with a web manifest, app icons, and mobile metadata. GipPity already provides HTTPS.",
			activation:
				"After writing a valid customWebAppPath, refresh or open the GipPity URL; the running server loads it without a restart.",
			config: {
				lan: {
					customWebApp: true,
					customWebAppPath: "/absolute/path/to/app",
				},
			},
			clientScript: `<script src="${LAN_REMOTE_CLIENT_PATH}"></script>`,
			example:
				"const remote = GippityRemote.connect(); remote.on('activity', console.log); await remote.call('pi', 'setThinkingLevel', 'high');",
		},
		client: {
			global: "GippityRemote",
			connect: "GippityRemote.connect()",
			methods: {
				on: "remote.on(eventType, listener) returns an unsubscribe function; use '*' for every event",
				call: "remote.call(target, method, ...args), where target is pi or context; method may be a dotted SDK path",
				setDraft:
					"remote.setDraft(text) updates and synchronizes the shared draft",
				flushDraft: "remote.flushDraft() waits for draft synchronization",
				send: "remote.send(text?) sends the shared draft to Pi",
				close: "remote.close() releases browser resources",
			},
			audio: {
				start: "remote.audio.start('conversation' | 'dictation')",
				stop: "remote.audio.stop(optionalDraftSnapshot); a dictation snapshot may contain text, revision, selectionStart, and selectionEnd",
				mute: "remote.audio.setMuted(boolean)",
				state: "Subscribe to the audio event",
			},
		},
		transport: {
			events: {
				method: "GET",
				path: "/api/events?client=<clientId>",
				format: "Server-Sent Events whose data is a JSON event object",
			},
			rpc: {
				method: "POST",
				path: "/api/rpc",
				request: {
					clientId: "string",
					id: "string | number | null",
					target: "pi | context",
					method: "Pi SDK method name",
					args: "JSON array",
				},
				response:
					"{ id, ok: true, result } or { id, ok: false, error: { name, message } }",
			},
			draft: ["POST /api/draft", "POST /api/send", "POST /api/stop"],
			audio: {
				path: "/api/audio?client=<clientId>",
				protocol:
					"WebSocket JSON control frames and signed 16-bit little-endian 24 kHz mono PCM binary frames",
			},
		},
		events: {
			connection:
				"{ type: 'connection', state: 'connected' | 'reconnecting' } (browser client only)",
			draft: "{ type: 'draft', text, revision, sourceClientId?, reason? }",
			activity:
				"{ type: 'activity', state: 'idle' | 'working' | 'settled', text? }",
			voice: ["status", "mute", "microphone", "stop", "error"],
			pi: "{ type: 'pi.event', event, data }",
			piEvents: [
				"session_info_changed",
				"session_compact",
				"agent_start",
				"agent_end",
				"agent_settled",
				"turn_start",
				"turn_end",
				"message_start",
				"message_update",
				"message_end",
				"tool_execution_start",
				"tool_execution_update",
				"tool_execution_end",
				"tool_call",
				"tool_result",
				"model_select",
				"thinking_level_select",
				"input",
			],
			audio:
				"{ type: 'audio', mode, active, busy, muted, inputTooQuiet, state, detail } (browser client only)",
		},
		rpcNotes: [
			"RPC forwards JSON-shaped arguments to the live Pi ExtensionAPI or ExtensionContext and returns the SDK result or error.",
			"Available context methods depend on how the server was launched; Pi remains authoritative.",
			"Callbacks, UI components, functions, and other non-JSON values cannot cross this transport.",
		],
	};
}
