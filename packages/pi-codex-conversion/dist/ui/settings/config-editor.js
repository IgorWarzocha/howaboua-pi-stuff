import { spawn } from "node:child_process";
import { getCodexConversionConfigPath, readCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config.js";
export function editorCommand() {
    return process.env["VISUAL"]?.trim() || process.env["EDITOR"]?.trim() || undefined;
}
export function splitEditorCommand(command, platform = process.platform) {
    const parts = [];
    let current = "";
    let quote;
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
            if (char === quote)
                quote = undefined;
            else
                current += char;
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
    if (escaping)
        current += "\\";
    if (current)
        parts.push(current);
    return parts;
}
export async function openCodexConfigInExternalEditor(stopTui, startTui, requestRender) {
    const editorCmd = editorCommand();
    if (!editorCmd)
        return { ok: false, error: "Set $VISUAL or $EDITOR to edit the config file." };
    writeCodexConversionConfig(readCodexConversionConfig());
    const file = getCodexConversionConfigPath();
    try {
        stopTui();
        const status = await new Promise((resolve) => {
            const [command, ...args] = splitEditorCommand(editorCmd);
            if (!command) {
                resolve(null);
                return;
            }
            const child = spawn(command, [...args, file], { stdio: "inherit", shell: false });
            child.on("error", () => resolve(null));
            child.on("close", (code) => resolve(code));
        });
        if (status !== 0)
            return { ok: false, error: "Editor exited without saving." };
        return { ok: true };
    }
    finally {
        startTui();
        requestRender(true);
    }
}
