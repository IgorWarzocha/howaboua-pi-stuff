import { existsSync } from "node:fs";
import {
	type ExtensionAPI,
	type ExtensionContext,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { ensureConfig } from "./config.js";
import { dbPathFor, openSearchDb } from "./db.js";
import { runIndex } from "./index-runner.js";
import { denyReason, findProjectRoot } from "./root.js";
import { formatMatches, type SearchMatch, searchDb } from "./search.js";

const semanticGrepSchema = Type.Object({
	query: Type.String({ description: "Natural-language search query" }),
	top_k: Type.Optional(
		Type.Integer({
			description: "Maximum matches to return",
			minimum: 1,
			maximum: 30,
		}),
	),
});

type SemanticGrepParams = Static<typeof semanticGrepSchema>;
type SemanticGrepDetails = {
	error?: string;
	root?: string;
	dbFile?: string;
	query?: string;
	matches?: SearchMatch[];
	skippedIncompatible?: number;
};

function cwdFromCtx(ctx: ExtensionContext): string {
	return ctx.cwd;
}

export default function semanticGrepExtension(pi: ExtensionAPI) {
	const extensionConfig = ensureConfig();
	let indexingController: AbortController | undefined;

	if (extensionConfig.toolRegistration)
		pi.registerTool<typeof semanticGrepSchema, SemanticGrepDetails>({
			name: "semantic_grep",
			label: "Semantic Grep",
			description: "Search indexed code and docs by meaning",
			promptSnippet: "Search code and docs by meaning",
			promptGuidelines: [
				"semantic_grep: Use early for conceptual or cross-file discovery",
				"semantic_grep: Query for behavior, concepts, features, or code paths—not exact identifiers",
				"semantic_grep: Inspect returned locations before precise claims or edits",
				"semantic_grep: Use exact text search for literal occurrences",
			],
			parameters: semanticGrepSchema,
			renderCall(args, theme) {
				const query = typeof args.query === "string" ? args.query : "";
				const shown = query.length > 90 ? `${query.slice(0, 87)}...` : query;
				let text = theme.fg("toolTitle", theme.bold("semantic_grep "));
				text += theme.fg("accent", `"${shown}"`);
				if (args.top_k) text += theme.fg("dim", ` top_k=${args.top_k}`);
				return new Text(text, 0, 0);
			},

			renderResult(result, { expanded, isPartial }, theme) {
				if (isPartial)
					return new Text(
						theme.fg("warning", "Searching semantic index…"),
						0,
						0,
					);
				if (result.details?.error) {
					const errorText = result.content.find(
						(item): item is { type: "text"; text: string } =>
							item.type === "text",
					)?.text;
					return new Text(
						theme.fg("error", errorText ?? result.details.error),
						0,
						0,
					);
				}

				const matches = result.details?.matches ?? [];
				if (!matches.length)
					return new Text(theme.fg("dim", "No semantic matches"), 0, 0);

				let text = theme.fg("success", `${matches.length} semantic matches`);
				text += theme.fg("dim", ` in ${result.details?.root ?? "repo"}`);
				if (!expanded)
					text += theme.fg(
						"muted",
						` (${keyHint("app.tools.expand", "expand")})`,
					);

				const limit = expanded ? matches.length : Math.min(matches.length, 5);
				for (const m of matches.slice(0, limit)) {
					text += `\n${theme.fg("accent", `${m.file}:${m.startLine}-${m.endLine}`)} ${theme.fg("dim", `score=${m.score.toFixed(4)}`)}`;
					if (expanded) {
						const preview = m.text.split("\n").slice(0, 12).join("\n");
						text += `\n${theme.fg("dim", preview)}`;
					}
				}
				if (!expanded && matches.length > limit)
					text += `\n${theme.fg("muted", `… ${matches.length - limit} more`)}`;
				return new Text(text, 0, 0);
			},

			async execute(
				_toolCallId,
				params: SemanticGrepParams,
				signal,
				_onUpdate,
				ctx,
			) {
				const baseConfig = ensureConfig();
				const root = findProjectRoot(cwdFromCtx(ctx), baseConfig);
				if (!root)
					throw new Error(
						"Semantic grep needs a project marker in the current directory or an ancestor",
					);
				const config = ensureConfig(root);
				const denied = denyReason(root, config);
				if (denied)
					throw new Error(`Semantic grep refused this root: ${denied}`);
				const dbFile = dbPathFor(root);
				if (!existsSync(dbFile))
					throw new Error(
						`Semantic grep index not found at ${dbFile}; indexing starts automatically with the session`,
					);
				const topK = Math.min(
					Math.max(1, params.top_k ?? config.search.defaultTopK),
					config.search.maxTopK,
					30,
				);
				const db = openSearchDb(root);
				try {
					const results = await searchDb(
						db,
						params.query,
						topK,
						config,
						signal,
					);
					return {
						content: [{ type: "text", text: formatMatches(results) }],
						details: {
							root,
							dbFile,
							query: params.query,
							matches: results.matches,
							skippedIncompatible: results.skippedIncompatible,
						},
					};
				} finally {
					db.close();
				}
			},
		});

	pi.on("session_start", (_event, ctx) => {
		const baseConfig = ensureConfig();
		if (!baseConfig.autoIndex.enabled) return;

		const root = findProjectRoot(cwdFromCtx(ctx), baseConfig);
		if (!root) {
			ctx.ui.notify(
				"Semantic grep skipped: no project marker found.",
				"warning",
			);
			return;
		}
		const config = ensureConfig(root);
		if (!config.autoIndex.enabled) return;

		const denied = denyReason(root, config);
		if (denied) {
			ctx.ui.notify(`Semantic grep skipped: ${denied}.`, "warning");
			return;
		}
		const dbFile = dbPathFor(root);
		if (config.autoIndex.mode === "missing" && existsSync(dbFile)) return;
		const forceFullRebuild = config.autoIndex.mode === "always";

		indexingController?.abort();
		const controller = new AbortController();
		indexingController = controller;
		ctx.ui.setStatus("semantic-grep", "indexing…");
		void (async () => {
			try {
				const result = await runIndex(
					root,
					config,
					forceFullRebuild,
					controller.signal,
					(message) => ctx.ui.setStatus("semantic-grep", message),
				);
				if (result.status === "busy") {
					ctx.ui.notify(
						"Semantic grep indexing is already running for this project",
						"info",
					);
					return;
				}
				const { stats } = result;
				ctx.ui.notify(
					`Semantic grep synced ${stats.files} files: +${stats.added} ~${stats.changed} -${stats.deleted}, ${stats.unchanged} unchanged, ${stats.metadataOnly} metadata-only${stats.skipped ? `, ${stats.skipped} skipped` : ""}${stats.fullRebuild ? " (resumable rebuild)" : ""}`,
					"info",
				);
			} catch (err) {
				if (controller.signal.aborted) return;
				ctx.ui.notify(
					`Semantic grep indexing failed: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			} finally {
				if (indexingController === controller) {
					indexingController = undefined;
					ctx.ui.setStatus("semantic-grep", undefined);
				}
			}
		})();
	});

	pi.on("session_shutdown", () => {
		indexingController?.abort();
		indexingController = undefined;
	});
}
