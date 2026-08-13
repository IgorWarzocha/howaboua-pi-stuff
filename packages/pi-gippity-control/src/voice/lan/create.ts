import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const CREATE_NOTICE_TYPE = "gippity-remote-create-notice";
const CREATE_PROMPT_TYPE = "gippity-remote-create-prompt";

interface CreateNoticeDetails {
	discoveryUrl: string;
}

interface CreatePromptDetails extends CreateNoticeDetails {
	appDirectory: string;
}

export function registerLanRemoteCreateRenderers(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<CreateNoticeDetails>(
		CREATE_NOTICE_TYPE,
		(entry, _options, theme) =>
			remoteBox(
				theme,
				"GipPity Remote",
				`No custom web app is connected.\nRun /gippity create to have Pi build one.\nDiscovery: ${entry.data?.discoveryUrl ?? "unavailable"}`,
			),
	);
	pi.registerMessageRenderer<CreatePromptDetails>(
		CREATE_PROMPT_TYPE,
		(message, _options, theme) =>
			remoteBox(
				theme,
				"GipPity Web App",
				`Creating a custom remote in ${message.details?.appDirectory ?? "the current project"}.\nContract: ${message.details?.discoveryUrl ?? "unavailable"}\nThe user must test live Pi operations.`,
			),
	);
}

export function appendLanRemoteCreateNotice(
	pi: ExtensionAPI,
	discoveryUrl: string,
): void {
	pi.appendEntry<CreateNoticeDetails>(CREATE_NOTICE_TYPE, { discoveryUrl });
}

export function lanRemoteCreatePrompt(options: {
	appDirectory: string;
	configPath: string;
	discoveryUrl: string;
}) {
	const instructions = [
		"GipPity custom remote web app creation was requested.",
		`Project directory: ${options.appDirectory}`,
		`Config file: ${options.configPath}`,
		`Live discovery and protocol documentation: ${options.discoveryUrl}`,
		"First fetch that discovery document (the local certificate may require curl -k) and familiarize yourself with its browser client, events, audio, draft, and Pi/context JSON-RPC contracts. Treat the live document as authoritative.",
		"Inspect the existing project, then implement a polished static web app in it. Use the hosted GippityRemote browser client so it retains GipPity's synchronization, audio, reconnection, and handoff behavior. Do not start or require another web server; GipPity hosts the static output.",
		"Set lan.customWebApp to true and lan.customWebAppPath to the absolute directory containing the finished index.html in the config file. Preserve every unrelated config value.",
		"Important: the live server is wired to this exact Pi session. Do not call its RPC endpoint, GippityRemote.call, send/draft controls, audio controls, or other live operations while implementing—the calls would target your own session and may interrupt or replace it. You may inspect GET discovery and client-script resources. Rely on the user to open the app, test operations, and report behavior.",
		"Build and statically validate the app. When it is ready, tell the user what changed and ask them to reload Pi, start the GipPity control server, and perform the live checks you need.",
	].join("\n");
	return {
		customType: CREATE_PROMPT_TYPE,
		content: instructions,
		display: true,
		details: {
			appDirectory: options.appDirectory,
			discoveryUrl: options.discoveryUrl,
		} satisfies CreatePromptDetails,
	};
}

function remoteBox(theme: Theme, labelText: string, bodyText: string): Box {
	const label = theme.bold(theme.fg("customMessageLabel", labelText));
	const body = theme.fg("customMessageText", bodyText);
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	box.addChild(new Text(`${label}\n${body}`, 0, 0));
	return box;
}
