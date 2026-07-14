import fs from "node:fs";
import path from "node:path";

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { findAgentsFiles } from "./subdir/agents-chain.js";
import { appendAgentsContext } from "./subdir/appendix.js";
import { collectBranchContext } from "./subdir/branch-state.js";
import type { PersistedContextFile } from "./subdir/details.js";
import { mergePersistedContextDetails } from "./subdir/details.js";
import { contentRootForTarget, resolvePath } from "./subdir/paths.js";
import {
	isDiscoveryShellCommand,
	isPathOutputShellCommand,
	shellOutputBase,
	shellOutputToolName,
	shellTargets,
} from "./subdir/shell-targets.js";
import {
	codeModeDiscoveryEvents,
	type DiscoveryEvent,
} from "./subdir/tool-events.js";

export function registerSubdirContextAutoload(pi: ExtensionAPI): void {
	const loadedAgents = new Set<string>();
	const loadedAgentsContent = new Map<string, string>();
	let currentCwd = "";
	let cwdAgentsPath = "";
	let readCount = 0;

	function relativePath(absolutePath: string): string {
		const relative = currentCwd
			? path.relative(currentCwd, absolutePath)
			: absolutePath;
		return (relative || absolutePath).replaceAll("\\", "/");
	}

	function resetSession(cwd: string): void {
		currentCwd = resolvePath(cwd, process.cwd());
		cwdAgentsPath = path.join(currentCwd, "AGENTS.md");
		readCount = 0;
		loadedAgents.clear();
		loadedAgentsContent.clear();
		loadedAgents.add(cwdAgentsPath);
	}

	function ensureSession(cwd: string): void {
		if (!currentCwd) resetSession(cwd);
	}

	function mergeRuntimeFromBranch(branchContext: Map<string, string>): void {
		loadedAgents.add(cwdAgentsPath);
		for (const [agentsPath, content] of branchContext.entries()) {
			loadedAgents.add(agentsPath);
			loadedAgentsContent.set(agentsPath, content);
		}
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
			return [base, ...pathsFromToolText(event.content, base, event.toolName)];
		}
		if (!shellInput) return [];
		const base = shellOutputBase(shellInput, eventCwd);
		const outputPaths = isPathOutputShellCommand(shellInput)
			? pathsFromToolText(event.content, base, shellOutputToolName(shellInput))
			: [];
		return [...shellTargets(shellInput, eventCwd), ...outputPaths];
	}

	function pathsFromToolText(
		content: Array<{ type: string; text?: string }>,
		base: string,
		toolName: string,
	): string[] {
		const maxLines = 250;
		return content.flatMap((item) => {
			if (item.type !== "text" || !item.text) return [];
			return item.text
				.split(/\r?\n/)
				.slice(0, maxLines)
				.map((line) => outputPathCandidate(line.trim(), toolName))
				.filter((line) => line && looksPathLike(line))
				.map((line) => resolvePath(line, base))
				.filter((candidate) => fs.existsSync(candidate));
		});
	}

	function outputPathCandidate(line: string, toolName: string): string {
		if (toolName !== "grep") return line;
		const match = line.match(/^(.+?):\d+(?::\d+)?:/);
		return match?.[1] ?? line.split(":", 1)[0] ?? line;
	}

	function looksPathLike(value: string): boolean {
		return Boolean(value) && !value.includes("\0") && !value.startsWith("<");
	}

	function agentsForTargets(targets: string[]): string[] {
		const paths = new Set<string>();
		for (const target of targets) {
			const searchRoot = contentRootForTarget(target);
			if (!searchRoot) continue;
			if (path.basename(target) === "AGENTS.md") {
				loadedAgents.add(path.normalize(target));
				continue;
			}
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

	async function readAppendixFiles(
		agentFiles: string[],
		branchContext: Map<string, string>,
		refreshAppendix: boolean,
	) {
		const loadedNow: string[] = [];
		const persistedFiles: PersistedContextFile[] = [];
		const appendixFiles: PersistedContextFile[] = [];
		const failedFiles: Array<{ agentsPath: string; error: Error }> = [];

		for (const agentsPath of agentFiles) {
			try {
				const content = await fs.promises.readFile(agentsPath, "utf-8");
				const wasLoaded = loadedAgents.has(agentsPath);
				const previousContent =
					loadedAgentsContent.get(agentsPath) ?? branchContext.get(agentsPath);
				const changed = previousContent !== content;
				loadedAgents.add(agentsPath);
				loadedAgentsContent.set(agentsPath, content);
				const rel = relativePath(agentsPath);
				if (changed) persistedFiles.push({ path: rel, content });
				if (!wasLoaded || changed || refreshAppendix)
					appendixFiles.push({ path: rel, content });
				if (!wasLoaded) loadedNow.push(rel);
			} catch (error) {
				if (error instanceof Error) failedFiles.push({ agentsPath, error });
			}
		}

		return { appendixFiles, failedFiles, loadedNow, persistedFiles };
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
		resetSession(ctx.cwd);
	};

	pi.on("session_start", handleSessionChange);
	pi.on("session_tree", handleSessionChange);

	pi.on("tool_result", async (event, ctx) => {
		ensureSession(ctx.cwd);

		const discoveryEvents = codeModeDiscoveryEvents(event);
		if (event.isError) discoveryEvents.shift();
		const targets = discoveryEvents.flatMap(targetsForEvent);
		if (!targets.length) return undefined;

		const branchContext = collectBranchContext(ctx, currentCwd, cwdAgentsPath);
		mergeRuntimeFromBranch(branchContext);
		readCount += 1;

		const agentFiles = agentsForTargets(targets);
		if (!agentFiles.length) return undefined;

		const result = await readAppendixFiles(
			agentFiles,
			branchContext,
			readCount % 10 === 0,
		);
		if (ctx.hasUI) {
			for (const failed of result.failedFiles) {
				ctx.ui.notify(
					`Failed to load ${failed.agentsPath}: ${failed.error.message}`,
					"warning",
				);
			}
		}

		notifyLoaded(ctx, result.loadedNow);

		if (!result.persistedFiles.length && !result.appendixFiles.length)
			return undefined;
		const details = result.persistedFiles.length
			? mergePersistedContextDetails(event.details, {
					files: result.persistedFiles,
				})
			: event.details;
		return {
			content: appendAgentsContext(event.content, result.appendixFiles),
			details,
		};
	});
}
