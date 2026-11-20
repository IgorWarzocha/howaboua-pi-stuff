import fs from "node:fs";
import path from "node:path";

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { findAgentsFiles } from "./subdir/agents-chain.js";
import { appendAgentsContext } from "./subdir/appendix.js";
import { collectBranchFingerprints } from "./subdir/branch-state.js";
import { fingerprint, mergePersistedContextDetails } from "./subdir/details.js";
import { contentRootForTarget, resolvePath } from "./subdir/paths.js";
import {
	isContentSearchShellCommand,
	isDiscoveryShellCommand,
	shellOutputBase,
	shellTargets,
} from "./subdir/shell-targets.js";
import {
	codeModeDiscoveryEvents,
	type DiscoveryEvent,
} from "./subdir/tool-events.js";

export function registerSubdirContextAutoload(
	pi: ExtensionAPI,
	developerMessages?: Partial<
		Pick<
			typeof import("@howaboua/pi-codex-conversion/developer-messages"),
			"trySendCodexDeveloperCustomMessage"
		>
	>,
): void {
	let fingerprints = new Map<string, string>();
	let currentCwd = "";
	let cwdAgentsPath = "";

	function relativePath(absolutePath: string): string {
		const relative = currentCwd
			? path.relative(currentCwd, absolutePath)
			: absolutePath;
		return (relative || absolutePath).replaceAll("\\", "/");
	}

	function restoreSession(ctx: ExtensionContext): void {
		currentCwd = resolvePath(ctx.cwd, process.cwd());
		cwdAgentsPath = path.join(currentCwd, "AGENTS.md");
		fingerprints = collectBranchFingerprints(ctx, currentCwd, cwdAgentsPath);
	}

	function targetsForEvent(event: DiscoveryEvent): string[] {
		const isRead = event.toolName === "read";
		const isPathDiscoveryTool = ["grep", "find", "ls"].includes(event.toolName);
		const workdir = ["workdir", "cwd", "working_directory"]
			.map((key) => event.input[key])
			.find((value): value is string => typeof value === "string");
		const eventCwd =
			workdir !== undefined ? resolvePath(workdir, currentCwd) : currentCwd;
		const shellInput =
			typeof event.input["command"] === "string"
				? event.input["command"]
				: typeof event.input["cmd"] === "string"
					? event.input["cmd"]
					: undefined;
		const isShell =
			event.toolName === "bash" ||
			event.toolName === "exec" ||
			event.toolName === "exec_command" ||
			event.toolName === "shell";
		if (!isRead && !isShell && !isPathDiscoveryTool) return [];
		const pathInput = event.input["path"] as string | undefined;
		const isDiscoveryShell =
			isShell &&
			typeof shellInput === "string" &&
			isDiscoveryShellCommand(shellInput);
		if (!isRead && !isPathDiscoveryTool && !isDiscoveryShell) return [];

		if (isRead)
			return pathInput ? [resolvePath(pathInput, eventCwd)] : [eventCwd];
		if (isPathDiscoveryTool) {
			const base = pathInput ? resolvePath(pathInput, eventCwd) : eventCwd;
			return event.toolName === "grep"
				? [base, ...pathsFromToolText(event.content, base)]
				: [base];
		}
		if (!shellInput) return [];
		const base = shellOutputBase(shellInput, eventCwd);
		const outputPaths = isContentSearchShellCommand(shellInput)
			? pathsFromToolText(event.content, base)
			: [];
		return [...shellTargets(shellInput, eventCwd), ...outputPaths];
	}

	function pathsFromToolText(
		content: Array<{ type: string; text?: string }>,
		base: string,
	): string[] {
		const maxLines = 250;
		return content.flatMap((item) => {
			if (item.type !== "text" || !item.text) return [];
			return item.text
				.split(/\r?\n/)
				.slice(0, maxLines)
				.map((line) => outputPathCandidate(line.trim()))
				.filter((line) => line && looksPathLike(line))
				.map((line) => resolvePath(line, base))
				.filter((candidate) => {
					try {
						return fs.statSync(candidate).isFile();
					} catch {
						return false;
					}
				});
		});
	}

	function outputPathCandidate(line: string): string {
		// Bare names can come from listings piped through grep, not file content.
		const start = /^[A-Za-z]:[\\/]/.test(line) ? 2 : 0;
		const separator = line.indexOf(":", start);
		return separator > start ? line.slice(0, separator) : "";
	}

	function looksPathLike(value: string): boolean {
		return Boolean(value) && !value.includes("\0") && !value.startsWith("<");
	}

	function agentsForTargets(targets: string[]): string[] {
		const paths = new Set<string>();
		for (const target of targets) {
			const searchRoot = contentRootForTarget(target);
			if (!searchRoot) continue;
			if (path.basename(target) === "AGENTS.md") continue;
			let probe = target;
			try {
				if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
					probe = path.join(target, "__probe__");
				}
			} catch {
				continue;
			}
			for (const file of findAgentsFiles(probe, searchRoot, cwdAgentsPath)) {
				paths.add(file);
			}
		}
		return [...paths];
	}

	async function readAppendixFiles(agentFiles: string[]) {
		const loadedNow: string[] = [];
		const appendixFiles: Array<{
			absolute: string;
			path: string;
			content: string;
			sha256: string;
		}> = [];
		const failedFiles: Array<{ agentsPath: string; error: Error }> = [];

		for (const agentsPath of agentFiles) {
			try {
				const content = await fs.promises.readFile(agentsPath, "utf-8");
				const previous = fingerprints.get(agentsPath);
				const sha256 = fingerprint(content);
				if (previous === sha256) continue;
				const rel = relativePath(agentsPath);
				appendixFiles.push({
					absolute: agentsPath,
					path: rel,
					content,
					sha256,
				});
				if (!previous) loadedNow.push(rel);
			} catch (error) {
				if (error instanceof Error) failedFiles.push({ agentsPath, error });
			}
		}

		return { appendixFiles, failedFiles, loadedNow };
	}

	function notifyLoaded(ctx: ExtensionContext, loadedNow: string[]): void {
		if (!loadedNow.length || !ctx.hasUI) return;
		const label =
			loadedNow.length === 1
				? `Loaded AGENTS.md context: ${loadedNow[0]}`
				: `Loaded AGENTS.md context (${loadedNow.length} files)`;
		ctx.ui.notify(label, "info");
	}

	const handleSessionChange = (
		_event: unknown,
		ctx: ExtensionContext,
	): void => {
		restoreSession(ctx);
	};

	pi.on("session_start", handleSessionChange);
	pi.on("session_tree", handleSessionChange);

	pi.on("tool_result", async (event, ctx) => {
		if (!currentCwd) restoreSession(ctx);

		// A native read exposes its result directly. A Code trace does not
		// prove the cell printed the file, and a partial read is not delivery.
		if (!event.isError && event.toolName === "read") {
			const [target] = targetsForEvent(event);
			const [item] = event.content;
			if (
				target &&
				target !== cwdAgentsPath &&
				path.basename(target) === "AGENTS.md" &&
				event.content.length === 1 &&
				item?.type === "text"
			) {
				const content = await fs.promises
					.readFile(target, "utf8")
					.catch(() => undefined);
				if (content !== undefined && content === item.text) {
					const sha256 = fingerprint(content);
					fingerprints.set(target, sha256);
					return {
						details: mergePersistedContextDetails(event.details, [
							{ path: relativePath(target), sha256 },
						]),
					};
				}
			}
		}

		const discoveryEvents = codeModeDiscoveryEvents(event);
		if (event.isError) discoveryEvents.shift();
		const targets = discoveryEvents.flatMap(targetsForEvent);
		if (!targets.length) return undefined;

		const agentFiles = agentsForTargets(targets);
		if (!agentFiles.length) return undefined;

		const result = await readAppendixFiles(agentFiles);
		if (ctx.hasUI) {
			for (const failed of result.failedFiles) {
				ctx.ui.notify(
					`Failed to load ${failed.agentsPath}: ${failed.error.message}`,
					"warning",
				);
			}
		}

		if (!result.appendixFiles.length) return undefined;
		const receipts = result.appendixFiles.map(({ path, sha256 }) => ({
			path,
			sha256,
		}));
		const sent =
			typeof developerMessages?.trySendCodexDeveloperCustomMessage ===
				"function" &&
			developerMessages.trySendCodexDeveloperCustomMessage(
				pi,
				{
					customType: "subdir-agents-context",
					content: appendAgentsContext([], result.appendixFiles)
						.map((item) => item.text)
						.join("\n"),
					display: true,
					details: mergePersistedContextDetails(undefined, receipts),
				},
				// triggerTurn:false skips the live loop and only persists history.
				{ deliverAs: "steer" },
			);

		// Commit only after delivery; failed sends must remain retryable.
		for (const { absolute, sha256 } of result.appendixFiles)
			fingerprints.set(absolute, sha256);
		if (sent) return undefined;
		notifyLoaded(ctx, result.loadedNow);
		return {
			content: appendAgentsContext(event.content, result.appendixFiles),
			details: mergePersistedContextDetails(event.details, receipts),
		};
	});
}
