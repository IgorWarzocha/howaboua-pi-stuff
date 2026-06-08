import { getShellConfig } from "@earendil-works/pi-coding-agent";

export const CODEX_FALLBACK_SHELL = "/bin/bash";

export function isFishShell(shell: string | undefined): boolean {
	const name = shell?.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	return name === "fish";
}

export function getCodexRuntimeShell(shell: string | undefined): string {
	if (!shell) {
		return CODEX_FALLBACK_SHELL;
	}
	return isFishShell(shell) ? CODEX_FALLBACK_SHELL : shell;
}

function getShellName(shell: string): string {
	return shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? shell.toLowerCase();
}

export function getCodexShellArgs(shell: string, command: string, login: boolean): string[] {
	const name = getShellName(shell);
	if (name === "cmd" || name === "cmd.exe") {
		return ["/d", "/s", "/c", command];
	}
	if (name === "powershell" || name === "powershell.exe" || name === "pwsh" || name === "pwsh.exe") {
		return ["-NoLogo", "-NoProfile", "-Command", command];
	}
	return login ? ["-lc", command] : ["-c", command];
}

export function getDefaultCodexRuntimeShell(): string {
	if (process.platform === "win32") {
		return getShellConfig().shell;
	}
	return getCodexRuntimeShell(process.env["SHELL"]);
}
