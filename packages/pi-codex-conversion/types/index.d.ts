import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function codexConversion(pi: ExtensionAPI): Promise<void>;
export function getCodexSkillPaths(cwd: string, home?: string): string[];
export function mergeAdapterTools(
	activeTools: string[],
	adapterTools: string[],
	adapterOwnedTools?: string[],
): string[];
export function restoreTools(
	previousTools: string[],
	activeTools: string[],
	adapterOwnedTools?: string[],
): string[];
export function stripAdapterTools(
	toolNames: string[],
	adapterOwnedTools?: string[],
): string[];
