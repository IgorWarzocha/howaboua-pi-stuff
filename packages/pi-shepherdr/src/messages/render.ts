import {
	type ExtensionAPI,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
	AGENT_EVENT_MESSAGE_TYPE,
	type AgentEventDetails,
	eventDetails,
} from "./event-details.js";

export function registerAgentEventRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<AgentEventDetails>(
		AGENT_EVENT_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const details = eventDetails(message.details);
			if (!details) {
				const box = new Box(outputPad, 1, (value) =>
					theme.bg("customMessageBg", value),
				);
				box.addChild(
					new Text(
						typeof message.content === "string"
							? message.content
							: "Herdr agent event unavailable",
						0,
						0,
					),
				);
				return box;
			}
			const blocked = details?.state === "blocked";
			const failed = details?.state === "failed";
			const notification = details.state === "extension-message";
			const agentIdentity = details?.name
				? `${details.name} (${details.paneId})`
				: (details?.paneId ?? "unknown");
			const identity = `${details.machineLabel ?? details.machine} / ${agentIdentity}`;
			const title = theme.fg(
				blocked || failed ? "error" : "success",
				`Herdr agent ${identity} · ${notification ? "extension message pending" : blocked ? "blocked" : failed ? "failed" : "finished"}`,
			);
			const location = [details?.workspace, details?.tab]
				.filter(Boolean)
				.join(" / ");
			const metadata = [location, details?.cwd].filter(Boolean).join(" · ");
			const box = new Box(outputPad, 1, (value) =>
				theme.bg("customMessageBg", value),
			);
			box.addChild(new Text(title, 0, 0));
			if (metadata) box.addChild(new Text(theme.fg("dim", metadata), 0, 0));
			if (blocked || notification) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(
						theme.fg(
							"warning",
							details?.blockedOn ??
								(notification
									? "Extension message pending"
									: "Agent needs input or approval"),
						),
						0,
						0,
					),
				);
				if (details.extensionMessages && expanded) {
					for (const message of details.extensionMessages) {
						box.addChild(new Spacer(1));
						box.addChild(
							new Markdown(message.message, 0, 0, getMarkdownTheme()),
						);
					}
				}
			}
			if (expanded && details?.task) {
				box.addChild(new Spacer(1));
				box.addChild(new Text(theme.fg("muted", "Task"), 0, 0));
				box.addChild(new Markdown(details.task, 0, 0, getMarkdownTheme()));
			}
			if (details?.response) {
				box.addChild(new Spacer(1));
				box.addChild(new Text(theme.fg("muted", "Response"), 0, 0));
				box.addChild(new Markdown(details.response, 0, 0, getMarkdownTheme()));
			}
			return box;
		},
	);
}
