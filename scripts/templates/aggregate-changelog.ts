// Generated aggregate packages copy this file during aggregate:sync.

import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DynamicBorder,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

interface BundleMetadata {
	name: string;
	version: string;
}

interface ChangelogEntry {
	content: string;
	version: string;
}

interface ChangelogEntryData {
	markdown: string;
	packageName: string;
}

function parseChangelog(markdown: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let currentLines: string[] = [];
	let currentVersion: string | undefined;

	for (const line of markdown.split("\n")) {
		const heading = line.match(/^##\s+\[?(\d+\.\d+\.\d+)\]?(?:\s.*)?$/);
		const version = heading?.[1];
		if (version) {
			if (currentVersion)
				entries.push({
					content: currentLines.join("\n").trim(),
					version: currentVersion,
				});
			currentVersion = version;
			currentLines = [line];
		} else if (currentVersion) {
			currentLines.push(line);
		}
	}

	if (currentVersion)
		entries.push({
			content: currentLines.join("\n").trim(),
			version: currentVersion,
		});
	return entries;
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	for (let index = 0; index < 3; index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function statePath(packageName: string): string {
	const name = packageName.replace(/^@/, "").replace(/[^a-zA-Z0-9_.-]+/g, "-");
	return join(getAgentDir(), "changelog", `${name}.json`);
}

function readSeenVersion(packageName: string): string | undefined {
	try {
		const state = JSON.parse(readFileSync(statePath(packageName), "utf8")) as {
			version?: unknown;
		};
		return typeof state.version === "string" ? state.version : undefined;
	} catch {
		return undefined;
	}
}

function writeSeenVersion(packageName: string, version: string): void {
	const path = statePath(packageName);
	mkdirSync(dirname(path), { mode: 0o700, recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify({ version })}\n`, {
			mode: 0o600,
		});
		renameSync(temporaryPath, path);
	} catch (error) {
		rmSync(temporaryPath, { force: true });
		throw error;
	}
}

export function registerBundleChangelog(pi: ExtensionAPI): void {
	let metadata: BundleMetadata;
	let entries: ChangelogEntry[];
	try {
		const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
		metadata = JSON.parse(
			readFileSync(join(packageDirectory, "package.json"), "utf8"),
		) as BundleMetadata;
		entries = parseChangelog(
			readFileSync(join(packageDirectory, "CHANGELOG.md"), "utf8"),
		);
	} catch (error) {
		pi.on("session_start", async (_event, ctx) => {
			ctx.ui.notify(
				`Could not load the Howaboua package changelog: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		});
		return;
	}

	const entryType = `${metadata.name}/changelog`;
	pi.registerEntryRenderer<ChangelogEntryData>(
		entryType,
		(entry, _options, theme) => {
			if (!entry.data) return undefined;
			const container = new Container();
			container.addChild(new DynamicBorder());
			container.addChild(
				new Text(
					theme.bold(
						theme.fg("accent", `What's New · ${entry.data.packageName}`),
					),
					1,
					0,
				),
			);
			container.addChild(new Spacer(1));
			container.addChild(
				new Markdown(entry.data.markdown.trim(), 1, 0, getMarkdownTheme()),
			);
			container.addChild(new Spacer(1));
			container.addChild(new DynamicBorder());
			return container;
		},
	);

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "reload" || ctx.mode !== "tui") return;
		if (
			ctx.sessionManager
				.getEntries()
				.some((entry) =>
					["branch_summary", "compaction", "message"].includes(entry.type),
				)
		)
			return;

		const seenVersion = readSeenVersion(metadata.name);
		// This feature cannot inherit state from older bundle versions, so its first
		// run shows the current release once instead of silently establishing a baseline.
		const unseenEntries = entries.filter(
			(entry) =>
				compareVersions(entry.version, metadata.version) <= 0 &&
				(seenVersion
					? compareVersions(entry.version, seenVersion) > 0
					: entry.version === metadata.version),
		);
		if (unseenEntries.length === 0) return;

		pi.appendEntry<ChangelogEntryData>(entryType, {
			markdown: unseenEntries.map((entry) => entry.content).join("\n\n"),
			packageName: metadata.name,
		});
		try {
			writeSeenVersion(metadata.name, metadata.version);
		} catch (error) {
			ctx.ui.notify(
				`Could not remember the ${metadata.name} changelog version: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});
}
