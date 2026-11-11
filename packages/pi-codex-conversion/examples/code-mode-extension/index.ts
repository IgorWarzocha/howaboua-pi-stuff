import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	adaptToolForCodeMode,
	registerCodeModeExtensionTools,
} from "@howaboua/pi-codex-conversion/code-mode";
import { obj, str, type Static } from "@earendil-works/pi-schema";

const PARAMETERS = obj({ text: str() });

const echo = defineTool({
	name: "echo",
	label: "Echo",
	description: "Return supplied text unchanged.",
	parameters: PARAMETERS,
	async execute(_toolCallId, { text }: Static<typeof PARAMETERS>) {
		return {
			content: [{ type: "text", text }],
			details: {},
		};
	},
});

export default function codeModeExtensionExample(pi: ExtensionAPI): void {
	pi.registerTool(echo);
	const registration = registerCodeModeExtensionTools(pi, () => [
		adaptToolForCodeMode(echo, {
			usage: 'await tools.echo({ text: "hello" })',
		}),
	]);
	pi.on("session_shutdown", () => registration.unregister());
}
