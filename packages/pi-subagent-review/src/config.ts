import fs from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	ALLOWED_THINKING,
	DEFAULT_CONFIG,
	getAgentDir,
	getConfigPath,
	REVIEW_COMMAND,
} from "./constants.js";
import type {
	ChildRunDetails,
	ParsedModelRef,
	ResolvedReviewConfig,
	ReviewConfig,
	ThinkingLevel,
	UsageStats,
} from "./types.js";

export function normalizeThinking(
	value: ThinkingLevel | undefined,
	fallback: ThinkingLevel = DEFAULT_CONFIG.thinking,
): ThinkingLevel {
	return value && ALLOWED_THINKING.has(value) ? value : fallback;
}

function migrateConfigFile(configPath: string): void {
	let parsed: ReviewConfig | undefined;
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as ReviewConfig;
	} catch {
		return;
	}

	if (parsed.summary !== undefined) return;

	const reviewModel =
		typeof parsed.model === "string" && parsed.model.trim()
			? parsed.model.trim()
			: DEFAULT_CONFIG.model;
	const migrated: ReviewConfig = {
		...parsed,
		summary: {
			enabled: DEFAULT_CONFIG.summary.enabled,
			model: reviewModel,
			thinking: DEFAULT_CONFIG.summary.thinking,
		},
	};
	fs.writeFileSync(
		configPath,
		`${JSON.stringify(migrated, null, 2)}\n`,
		"utf8",
	);
}

export function ensureConfigFile(): string {
	const agentDir = getAgentDir();
	const configPath = getConfigPath();
	fs.mkdirSync(agentDir, { recursive: true });
	if (!fs.existsSync(configPath)) {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
			"utf8",
		);
	} else {
		migrateConfigFile(configPath);
	}
	return configPath;
}

export function readConfig(): Omit<ResolvedReviewConfig, "source"> {
	let parsed: ReviewConfig | undefined;
	const configPath = ensureConfigFile();
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as ReviewConfig;
	} catch (error) {
		throw new Error(
			`Could not parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const reviewModel =
		typeof parsed?.model === "string" && parsed.model.trim()
			? parsed.model.trim()
			: DEFAULT_CONFIG.model;
	const summary = parsed?.summary;
	const configuredSummaryModel =
		typeof summary?.model === "string" && summary.model.trim()
			? summary.model.trim()
			: reviewModel;
	const defaultSummaryModelParsed = splitModelRef(
		DEFAULT_CONFIG.summary.model,
	)!;
	const summaryModelParsed =
		splitModelRef(configuredSummaryModel) ?? defaultSummaryModelParsed;
	const summaryModel = `${summaryModelParsed.provider}/${summaryModelParsed.modelId}`;

	return {
		model: reviewModel,
		thinking: normalizeThinking(parsed?.thinking),
		summary: {
			enabled:
				typeof summary?.enabled === "boolean"
					? summary.enabled
					: DEFAULT_CONFIG.summary.enabled,
			model: summaryModel,
			modelParsed: summaryModelParsed,
			thinking: normalizeThinking(
				summary?.thinking,
				DEFAULT_CONFIG.summary.thinking,
			),
			source: "configured",
		},
	};
}

function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function createChildRunDetails(
	task: string,
	cwd: string,
	config = readConfig(),
): ChildRunDetails {
	return {
		mode: "review",
		toolName: REVIEW_COMMAND,
		task,
		cwd,
		model: config.model,
		thinking: config.thinking,
		messages: [],
		stderr: "",
		exitCode: 0,
		usage: emptyUsage(),
	};
}

export function isSubagentFailure(
	details: Pick<ChildRunDetails, "exitCode" | "stopReason">,
): boolean {
	return (
		details.exitCode !== 0 ||
		details.stopReason === "error" ||
		details.stopReason === "aborted"
	);
}

function splitModelRef(modelRef: string): ParsedModelRef | undefined {
	const slash = modelRef.indexOf("/");
	if (slash <= 0 || slash === modelRef.length - 1) return undefined;
	return {
		provider: modelRef.slice(0, slash),
		modelId: modelRef.slice(slash + 1),
	};
}

async function canUseModel(
	ctx: ExtensionCommandContext,
	modelRef: string,
): Promise<boolean> {
	const parsed = splitModelRef(modelRef);
	if (!parsed) return false;
	const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
	if (!model) return false;
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	return auth.ok;
}

export async function resolveReviewConfig(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<ResolvedReviewConfig> {
	const configured = readConfig();
	let summary = configured.summary;

	if (
		summary.enabled &&
		!(await canUseModel(ctx, summary.model)) &&
		ctx.model
	) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok) {
			const currentModel = `${ctx.model.provider}/${ctx.model.id}`;
			summary = {
				...summary,
				model: currentModel,
				modelParsed: { provider: ctx.model.provider, modelId: ctx.model.id },
				source: "current",
			};
		}
	}

	if (await canUseModel(ctx, configured.model)) {
		return { ...configured, summary, source: "configured" };
	}

	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok) {
			return {
				model: `${ctx.model.provider}/${ctx.model.id}`,
				thinking: pi.getThinkingLevel() as ThinkingLevel,
				source: "current",
				summary,
			};
		}
	}

	return { ...configured, summary, source: "configured" };
}
