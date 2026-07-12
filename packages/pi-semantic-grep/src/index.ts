import { existsSync } from "node:fs";
import {
	type ExtensionAPI,
	type ExtensionContext,
	keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { ensureConfig } from "./config.js";
import { dbPathFor, openDb } from "./db.js";
import { syncIndex } from "./indexer.js";
import { denyReason, findProjectRoot } from "./root.js";
import { formatMatches, type SearchMatch, searchDb } from "./search.js";

const semanticGrepSchema = Type.Object({
	query: Type.String({ description: "Natural-language search query." }),
	top_k: Type.Optional(
		Type.Number({ description: "Maximum matches to return." }),
	),
});

type SemanticGrepParams = Static<typeof semanticGrepSchema>;
type SemanticGrepDetails = {
	error?: string;
	reason?: string;
	root?: string;
	dbFile?: string;
	query?: string;
	matches?: SearchMatch[];
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
			description: "Search code and docs by meaning.",
			promptSnippet: "Use semantic_grep for conceptual code/docs discovery.",
			promptGuidelines: [
				"semantic_grep: Use early for conceptual or cross-file discovery.",
				"semantic_grep: Query for behavior, concepts, features, or code paths—not just exact identifiers.",
				"semantic_grep: Inspect returned locations with file-reading tools before making precise claims or edits.",
				"semantic_grep: Use exact text search instead when you need literal string occurrences.",
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
				if (!root) {
					return {
						content: [
							{
								type: "text",
								text: "Semantic grep skipped: no project marker found.",
							},
						],
						details: { error: "no_project_root" },
					};
				}
				const config = ensureConfig(root);
				const denied = denyReason(root, config);
				if (denied) {
					return {
						content: [
							{ type: "text", text: `Semantic grep skipped: ${denied}.` },
						],
						details: { error: "denied_root", root, reason: denied },
					};
				}
				const dbFile = dbPathFor(root);
				if (!existsSync(dbFile)) {
					return {
						content: [
							{
								type: "text",
								text: `Semantic grep index not found at ${dbFile}. It should be created automatically at session start; check extension logs/status.`,
							},
						],
						details: { error: "missing_index", dbFile },
					};
				}
				const topK = Math.min(
					Math.max(1, params.top_k ?? config.search.defaultTopK),
					config.search.maxTopK,
				);
				const db = openDb(root);
				try {
					const matches = await searchDb(
						db,
						params.query,
						topK,
						config,
						signal,
					);
					return {
						content: [{ type: "text", text: formatMatches(matches) }],
						details: { root, dbFile, query: params.query, matches },
					};
				} finally {
					db.close();
				}
			},
		});

	pi.on("session_start", async (_event, ctx) => {
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
		const db = openDb(root);
		ctx.ui.setStatus("semantic-grep", "indexing…");
		try {
			const stats = await syncIndex(
				db,
				root,
				config,
				forceFullRebuild,
				controller.signal,
				(msg) => ctx.ui.setStatus("semantic-grep", msg),
			);
			ctx.ui.notify(
				`Semantic grep synced ${stats.files} files: +${stats.added} ~${stats.changed} -${stats.deleted}, ${stats.unchanged} unchanged${stats.fullRebuild ? " (full rebuild)" : ""}`,
				"info",
			);
		} catch (err) {
			if (controller.signal.aborted) return;
			ctx.ui.notify(
				`Semantic grep indexing failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		} finally {
			if (indexingController === controller) indexingController = undefined;
			ctx.ui.setStatus("semantic-grep", undefined);
			db.close();
		}
	});

	pi.on("session_shutdown", () => {
		indexingController?.abort();
		indexingController = undefined;
	});
}
