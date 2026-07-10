import { spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const NATIVE_COMPACTION_STRATEGY = "openai-native-compact-v1";
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

type Config = {
	enabled: boolean;
	model: string;
	thinking?: ThinkingLevel;
	inboxPath: string;
	prompt?: string;
	timeoutMs: number;
	includeProjectContext: boolean;
	minUserMessagesWithoutBlob: number;
};

type NativeCompactionEntry = {
	id: string;
	type: "compaction";
	summary?: string;
	firstKeptEntryId?: string;
	details: {
		strategy?: string;
		provider?: string;
		api?: string;
		baseUrl?: string;
		compactedWindow: unknown[];
	};
};

type PiCompactionEntry = {
	id: string;
	type: "compaction";
	summary: string;
	firstKeptEntryId?: string;
};

const DEFAULT_PROMPT = `You are running as an ephemeral memory distiller after a Pi session ended.

You already received Pi's normal context files (global and project AGENTS.md/CLAUDE.md), but skills were intentionally disabled.

Use the compacted session context, if present, and the recent conversation tail to find durable memories useful in the future — coming days, weeks, or months.

Find 3-5 durable memory candidates if they genuinely exist. Prefer fewer strong memories over filling the quota.

Good memories:
- stable user preferences
- communication style
- durable workflow preferences
- recurring project conventions
- decisions likely to matter later
- things that belong in global or project AGENTS.md

Bad memories:
- temporary task progress
- implementation minutiae
- one-off facts
- obvious summaries
- secrets or credentials
- anything already clearly covered by existing context files

Output markdown only. If nothing is worth remembering, output exactly: No durable memories.

Format:
### Global candidates
- ...

### Project candidates
- ...

### Why these matter
- ...`;

function defaultConfig(): Config {
	const agentDir = getAgentDir();
	return {
		enabled: true,
		model: "gpt-5.4",
		thinking: "low",
		inboxPath: join(agentDir, "memory-inbox.md"),
		timeoutMs: 120_000,
		includeProjectContext: true,
		minUserMessagesWithoutBlob: 3,
	};
}

function configPath(): string {
	return join(getAgentDir(), "pi-memories.json");
}

function writeDefaultConfig(path: string, config: Config): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function normalizeThinkingLevel(
	value: unknown,
	fallback: ThinkingLevel = "low",
): ThinkingLevel {
	return typeof value === "string" &&
		THINKING_LEVELS.has(value as ThinkingLevel)
		? (value as ThinkingLevel)
		: fallback;
}

export function shouldDistillOnShutdown(reason: string): boolean {
	return reason === "quit";
}

function loadConfig(): Config {
	const base = defaultConfig();
	const path = configPath();
	if (!existsSync(path)) {
		writeDefaultConfig(path, base);
		return base;
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
		return {
			...base,
			...raw,
			thinking: normalizeThinkingLevel(raw.thinking, base.thinking),
		};
	} catch {
		return base;
	}
}

function isNativeCompactionEntry(
	entry: unknown,
): entry is NativeCompactionEntry {
	const e = entry as NativeCompactionEntry | undefined;
	return Boolean(
		e &&
			e.type === "compaction" &&
			e.details &&
			(!e.details.strategy ||
				e.details.strategy === NATIVE_COMPACTION_STRATEGY) &&
			Array.isArray(e.details.compactedWindow),
	);
}

function logDebug(config: Config, message: string): void {
	void config;
	void message;
	return;
}

function findLatestNativeCompaction(
	branch: readonly unknown[],
): { entry: NativeCompactionEntry; index: number } | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isNativeCompactionEntry(entry)) return { entry, index: i };
	}
	return undefined;
}

function isPiCompactionEntry(entry: unknown): entry is PiCompactionEntry {
	const e = entry as PiCompactionEntry | undefined;
	return Boolean(
		e &&
			e.type === "compaction" &&
			typeof e.summary === "string" &&
			e.summary.trim().length > 0,
	);
}

function findLatestPiCompaction(
	branch: readonly unknown[],
): { entry: PiCompactionEntry; index: number } | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isNativeCompactionEntry(entry)) continue;
		if (isPiCompactionEntry(entry)) return { entry, index: i };
	}
	return undefined;
}

function compactTailText(entries: readonly unknown[]): string {
	const chunks: string[] = [];
	for (const entry of entries) {
		const e = entry as any;
		if (e?.type !== "message") continue;
		const msg = e.message;
		const role = msg?.role;
		if (!role || role === "toolResult") continue;
		const text = extractText(msg.content);
		if (!text.trim()) continue;
		chunks.push(`[${role}]: ${text.trim()}`);
	}
	const joined = chunks.join("\n\n");
	return joined;
}

function countUserMessages(entries: readonly unknown[]): number {
	let count = 0;
	for (const entry of entries) {
		const e = entry as any;
		if (e?.type === "message" && e.message?.role === "user") count++;
	}
	return count;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => {
			if (part?.type === "text" && typeof part.text === "string")
				return part.text;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function writeTempBridge(payloadPath: string): string {
	const bridgePath = join(dirname(payloadPath), "bridge.ts");
	writeFileSync(
		bridgePath,
		`import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";\n` +
			`import { readFileSync } from "node:fs";\n` +
			`const payload = JSON.parse(readFileSync(${JSON.stringify(payloadPath)}, "utf8"));\n` +
			`export default function(pi: ExtensionAPI) {\n` +
			`  pi.on("before_provider_request", async (event) => {\n` +
			`    const p: any = event.payload;\n` +
			`    if (!p || !Array.isArray(p.input)) return undefined;\n` +
			`    const preamble = p.input.filter((x: any) => x && typeof x === "object" && (x.role === "system" || x.role === "developer"));\n` +
			`    return { ...p, input: [...preamble, ...payload.compactedWindow, { role: "user", content: payload.userContent }] };\n` +
			`  });\n` +
			`}\n`,
	);
	return bridgePath;
}

function runPiMemorySession(args: {
	cwd: string;
	config: Config;
	compactedWindow: unknown[];
	summaryText?: string;
	tailText: string;
}): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "pi-memories-"));
	const payloadPath = join(dir, "payload.json");
	const summarySection = args.summaryText?.trim()
		? `\n\n<previous-compaction-summary>\n${args.summaryText.trim()}\n</previous-compaction-summary>`
		: "";
	const userContent = `${args.config.prompt ?? DEFAULT_PROMPT}${summarySection}\n\n<recent-tail>\n${args.tailText}\n</recent-tail>`;
	writeFileSync(
		payloadPath,
		JSON.stringify({ compactedWindow: args.compactedWindow, userContent }),
	);
	const bridgePath = writeTempBridge(payloadPath);

	const cliArgs = [
		"--no-session",
		"--no-skills",
		"--no-tools",
		"-e",
		bridgePath,
		"--model",
		args.config.model,
	];
	if (args.config.thinking) cliArgs.push("--thinking", args.config.thinking);
	if (!args.config.includeProjectContext) cliArgs.push("--no-context-files");
	cliArgs.push("-p", "Run the shutdown memory distiller now.");

	return new Promise((resolve, reject) => {
		const child = spawn("pi", cliArgs, {
			cwd: args.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_MEMORIES_CHILD: "1" },
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new Error(`memory session timed out after ${args.config.timeoutMs}ms`),
			);
		}, args.config.timeoutMs);
		child.stdout.on("data", (d) => (stdout += d.toString()));
		child.stderr.on("data", (d) => (stderr += d.toString()));
		child.on("error", (err) => {
			clearTimeout(timer);
			rmSync(dir, { recursive: true, force: true });
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			rmSync(dir, { recursive: true, force: true });
			if (code === 0) resolve(stdout.trim());
			else
				reject(new Error(`pi memory session exited ${code}: ${stderr.trim()}`));
		});
	});
}

function appendInbox(
	config: Config,
	ctx: ExtensionContext,
	content: string,
): void {
	const trimmed = content.trim();
	if (!trimmed || trimmed === "No durable memories.") return;
	mkdirSync(dirname(config.inboxPath), { recursive: true });
	const stamp = new Date().toISOString();
	appendFileSync(
		config.inboxPath,
		`\n## ${stamp} — shutdown candidates\n\n` +
			`cwd: \`${ctx.cwd}\`\n\n` +
			`${trimmed}\n`,
		"utf8",
	);
}

export default function piMemories(pi: ExtensionAPI) {
	loadConfig();

	pi.on("session_shutdown", async (event, ctx) => {
		if (process.env["PI_MEMORIES_CHILD"] === "1") return;
		if (!shouldDistillOnShutdown(event.reason)) return;
		const config = loadConfig();
		if (!config.enabled) return;
		logDebug(config, `shutdown cwd=${ctx.cwd}`);

		const branch = ctx.sessionManager.getBranch();
		logDebug(config, `branch entries=${branch.length}`);
		const latest = findLatestNativeCompaction(branch);
		const latestPi = latest ? undefined : findLatestPiCompaction(branch);
		if (latest) {
			logDebug(
				config,
				`native compaction found index=${latest.index} id=${latest.entry.id} window=${latest.entry.details.compactedWindow.length}`,
			);
		} else if (latestPi) {
			logDebug(
				config,
				`pi compaction found index=${latestPi.index} id=${latestPi.entry.id} summaryChars=${latestPi.entry.summary.length}`,
			);
		} else {
			logDebug(
				config,
				"no native compaction entry found; using branch tail only",
			);
		}

		const compactedWindow = latest?.entry.details.compactedWindow ?? [];
		const summaryText = latestPi?.entry.summary;
		const tailStartIndex = latest?.index ?? latestPi?.index;
		const tailEntries =
			tailStartIndex === undefined ? branch : branch.slice(tailStartIndex + 1);
		if (!latest && !latestPi) {
			const userMessages = countUserMessages(branch);
			if (userMessages < config.minUserMessagesWithoutBlob) {
				logDebug(
					config,
					`short no-blob session skipped userMessages=${userMessages} min=${config.minUserMessagesWithoutBlob}`,
				);
				return;
			}
		}
		const tailText = compactTailText(tailEntries);
		if (compactedWindow.length === 0 && tailText.trim().length === 0) {
			logDebug(config, "nothing serializable for memory session");
			return;
		}
		try {
			logDebug(
				config,
				`spawning memory session blobItems=${compactedWindow.length} tailChars=${tailText.length}`,
			);
			const result = await runPiMemorySession({
				cwd: ctx.cwd,
				config,
				compactedWindow,
				tailText,
				...(summaryText ? { summaryText } : {}),
			});
			logDebug(config, `memory session completed chars=${result.length}`);
			appendInbox(config, ctx, result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logDebug(config, `failed: ${message}`);
			mkdirSync(dirname(config.inboxPath), { recursive: true });
			appendFileSync(
				config.inboxPath,
				`\n<!-- pi-memories failed: ${message.replaceAll("--", "—")} -->\n`,
				"utf8",
			);
		}
	});

	pi.registerCommand("memory-review", {
		description: "Review memory-inbox.md and decide what belongs in AGENTS.md",
		handler: async (_args, ctx) => {
			const config = loadConfig();
			ctx.ui.setEditorText(
				`Review ${config.inboxPath} and decide whether any candidates should be promoted into global or project AGENTS.md.

Treat the inbox as candidates, not truth. Promote only durable memories useful over coming days, weeks, or months. Prefer user preferences, communication style, durable workflow habits, identity, and project conventions. Discard temporary task progress, implementation minutiae, duplicate notes, obvious summaries, secrets, credentials, tokens, and sensitive personal data. Merge new memories into existing bullets instead of accumulating near-duplicates. Keep promoted memories short, concrete, and easy to delete later. When done, leave the inbox file empty. Do not leave review logs, comments, markers, or commentary in memory-inbox.md.`,
			);
		},
	});
}
