import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const CREATE_NOTICE_TYPE = "gippity-remote-create-notice";
const CREATE_PROMPT_TYPE = "gippity-remote-create-prompt";
const CREATE_PROMPT_HEADER =
	"GipPity custom remote web app creation was requested.";
const CREATE_PROMPT_GUIDANCE = [
	"First fetch that discovery document (the local certificate may require curl -k) and familiarize yourself with its browser client, events, audio, draft, and Pi/context JSON-RPC contracts. Treat the live document as authoritative.",
	"This first turn is research and product discovery only. Inspect the existing project and the read-only GET documentation, but do not create or edit files, install dependencies, change config, or begin implementation.",
	"After investigating, quiz the user about what they want the app to do and feel like: its purpose, desired controls and status, visual direction, target devices/layout, genuine non-negotiables, and whether it should be global or only for the current project. Do not burden them with implementation choices you can infer yourself. Then stop and wait for their answer.",
	"Only after the user answers should you implement a polished static web app. Use the hosted GippityRemote browser client so it retains GipPity's synchronization, audio, reconnection, and handoff behavior. Do not start or require another web server; GipPity hosts the static output.",
	"When implementation is complete, set lan.customWebApp to true and lan.customWebAppPath to the directory containing the finished index.html. Use an absolute path for one global app in every directory, or a path relative to the Pi session cwd for a project-specific app. Preserve every unrelated config value. The running GipPity server discovers a valid new path automatically; ask the user to refresh or open its URL.",
	"Important: the live server is wired to this exact Pi session. Do not call its RPC endpoint, GippityRemote.call, send/draft controls, audio controls, or other live operations while implementing—the calls would target your own session and may interrupt or replace it. You may inspect GET discovery and client-script resources. Rely on the user to open the app, test operations, and report behavior.",
	"Build and statically validate the app. When it is ready, tell the user what changed, ask them to refresh or open the GipPity URL, and have them perform the live checks you need.",
] as const;

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
	pi.registerEntryRenderer<CreatePromptDetails>(
		CREATE_PROMPT_TYPE,
		(entry, _options, theme) =>
			remoteBox(
				theme,
				"GipPity Web App",
				`Planning a custom remote in ${entry.data?.appDirectory ?? "the current project"}.\nContract: ${entry.data?.discoveryUrl ?? "unavailable"}\nPi will inspect the contract, then ask what you want.`,
			),
	);
	pi.registerMarkdownTransformer((markdown, { messageType }) =>
		messageType === "user" && isLanRemoteCreatePrompt(markdown) ? "" : markdown,
	);
}

export function appendLanRemoteCreateNotice(
	pi: ExtensionAPI,
	discoveryUrl: string,
): void {
	pi.appendEntry<CreateNoticeDetails>(CREATE_NOTICE_TYPE, { discoveryUrl });
}

export function startLanRemoteCreateTurn(
	pi: ExtensionAPI,
	options: {
		appDirectory: string;
		configPath: string;
		discoveryUrl: string;
	},
): void {
	pi.appendEntry<CreatePromptDetails>(CREATE_PROMPT_TYPE, {
		appDirectory: options.appDirectory,
		discoveryUrl: options.discoveryUrl,
	});
	pi.sendUserMessage(lanRemoteCreatePrompt(options));
}

function lanRemoteCreatePrompt(options: {
	appDirectory: string;
	configPath: string;
	discoveryUrl: string;
}): string {
	return [
		CREATE_PROMPT_HEADER,
		`Project directory: ${options.appDirectory}`,
		`Config file: ${options.configPath}`,
		`Live discovery and protocol documentation: ${options.discoveryUrl}`,
		...CREATE_PROMPT_GUIDANCE,
	].join("\n");
}

function isLanRemoteCreatePrompt(markdown: string): boolean {
	const lines = markdown.split("\n");
	return (
		lines.length === CREATE_PROMPT_GUIDANCE.length + 4 &&
		lines[0] === CREATE_PROMPT_HEADER &&
		lines[1]?.startsWith("Project directory: ") === true &&
		lines[2]?.startsWith("Config file: ") === true &&
		lines[3]?.startsWith("Live discovery and protocol documentation: ") ===
			true &&
		CREATE_PROMPT_GUIDANCE.every((line, index) => lines[index + 4] === line)
	);
}

function remoteBox(theme: Theme, labelText: string, bodyText: string): Box {
	const label = theme.bold(theme.fg("customMessageLabel", labelText));
	const body = theme.fg("customMessageText", bodyText);
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	box.addChild(new Text(`${label}\n${body}`, 0, 0));
	return box;
}
