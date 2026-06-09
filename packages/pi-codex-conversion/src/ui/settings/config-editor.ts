import { spawn } from "node:child_process";
import { getCodexConversionConfigPath, readCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config.ts";

export function editorCommand(): string | undefined {
	return process.env["VISUAL"]?.trim() || process.env["EDITOR"]?.trim() || undefined;
}

export function splitEditorCommand(command: string, platform: NodeJS.Platform = process.platform): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;
	const useBackslashEscapes = platform !== "win32";
	for (const char of command) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (useBackslashEscapes && char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				parts.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (escaping) current += "\\";
	if (current) parts.push(current);
	return parts;
}

export async function openCodexConfigInExternalEditor(
	stopTui: () => void,
	startTui: () => void,
	requestRender: (full?: boolean) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const editorCmd = editorCommand();
	if (!editorCmd) return { ok: false, error: "Set $VISUAL or $EDITOR to edit the config file." };
	writeCodexConversionConfig(readCodexConversionConfig());
	const file = getCodexConversionConfigPath();
	try {
		stopTui();
		const status = await new Promise<number | null>((resolve) => {
			const [command, ...args] = splitEditorCommand(editorCmd);
			if (!command) {
				resolve(null);
				return;
			}
			const child = spawn(command, [...args, file], { stdio: "inherit", shell: false });
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code));
		});
		if (status !== 0) return { ok: false, error: "Editor exited without saving." };
		return { ok: true };
	} finally {
		startTui();
		requestRender(true);
	}
}
