import { getAgentDir, getShellConfig, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CODEX_FALLBACK_SHELL = "/bin/bash";

export function isFishShell(shell: string | undefined): boolean {
	const name = shell?.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
	return name === "fish";
}

export function getCodexRuntimeShell(shell: string | undefined): string {
	if (!shell) {
		return CODEX_FALLBACK_SHELL;
	}
	if (!isFishShell(shell)) return shell;
	return process.platform === "win32" ? getShellConfig().shell : CODEX_FALLBACK_SHELL;
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

export function getDefaultCodexRuntimeShell(configuredShellPath?: string): string {
	if (configuredShellPath) {
		return getCodexRuntimeShell(getShellConfig(configuredShellPath).shell);
	}
	if (process.platform === "win32") {
		return getShellConfig().shell;
	}
	return getCodexRuntimeShell(process.env["SHELL"]);
}

export function getPiCodexRuntimeShell(
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
	agentDir: string = getAgentDir(),
): string {
	const configuredShellPath = getPiConfiguredShellPath(ctx, agentDir);
	try {
		return getDefaultCodexRuntimeShell(configuredShellPath);
	} catch {
		return getCodexRuntimeShell(configuredShellPath ?? process.env["SHELL"]);
	}
}

export function getPiConfiguredShellPath(
	ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
	agentDir: string = getAgentDir(),
): string | undefined {
	const settings = SettingsManager.create(ctx.cwd, agentDir, {
		projectTrusted: ctx.isProjectTrusted(),
	});
	return settings.getShellPath();
}
