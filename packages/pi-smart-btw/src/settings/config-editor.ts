import { spawn } from "node:child_process";
import { configPath, ensureConfig } from "../config.js";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function editorCommand(): string | undefined {
	const visual = process.env["VISUAL"]?.trim();
	const editor = process.env["EDITOR"]?.trim();
	return visual || editor || undefined;
}

export async function openConfigInExternalEditor(
	stopTui: () => void,
	startTui: () => void,
	requestRender: (full?: boolean) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const editorCmd = editorCommand();
	if (!editorCmd) {
		return {
			ok: false,
			error: "Set $VISUAL or $EDITOR to edit the config file.",
		};
	}
	ensureConfig();
	const file = configPath();
	try {
		stopTui();
		const status = await new Promise<number | null>((resolve) => {
			const child = spawn(`${editorCmd} ${shellQuote(file)}`, {
				stdio: "inherit",
				shell: true,
			});
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code));
		});
		if (status !== 0) {
			return { ok: false, error: "Editor exited without saving." };
		}
		return { ok: true };
	} finally {
		startTui();
		requestRender(true);
	}
}
