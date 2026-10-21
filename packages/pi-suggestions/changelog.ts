// Generated extension packages copy this file during changelog:extensions.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DynamicBorder,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

const ENTRY_TYPE = "@howaboua/pi-stuff/changelog";
const REGISTRATION_CHANNEL = "@howaboua/pi-stuff/changelog/register/v1";
const STATE_FILENAME = "howaboua-pi-stuff-changelog.json";
const SUPPRESS_KEY = "suppress";
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 2_000;

interface PackageMetadata {
	name: string;
	version: string;
}

interface PackageRegistration extends PackageMetadata {
	changelogPath: string;
}

interface RegistrationEvent {
	accept: () => void;
	registration: PackageRegistration;
}

interface ChangelogEntry {
	content: string;
	version: string;
}

interface ChangelogEntryData {
	markdown: string;
}

type ChangelogState = Record<string, boolean | string>;

function packageRegistration(): PackageRegistration {
	const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
	const metadata = JSON.parse(
		readFileSync(join(packageDirectory, "package.json"), "utf8"),
	) as Partial<PackageMetadata>;
	if (typeof metadata.name !== "string" || typeof metadata.version !== "string")
		throw new Error(`Invalid package metadata in ${packageDirectory}`);
	return {
		name: metadata.name,
		version: metadata.version,
		changelogPath: join(packageDirectory, "CHANGELOG.md"),
	};
}

function isRegistrationEvent(value: unknown): value is RegistrationEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<RegistrationEvent>;
	return (
		typeof event.accept === "function" &&
		typeof event.registration?.name === "string" &&
		typeof event.registration.version === "string" &&
		typeof event.registration.changelogPath === "string"
	);
}

function parseChangelog(markdown: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let currentLines: string[] = [];
	let currentVersion: string | undefined;

	for (const line of markdown.split("\n")) {
		const version = line.match(/^##\s+\[?(\d+\.\d+\.\d+)\]?(?:\s.*)?$/)?.[1];
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

function isStableVersion(version: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(version);
}

function statePath(): string {
	return join(getAgentDir(), STATE_FILENAME);
}

async function readState(path: string): Promise<ChangelogState> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	const parsed = JSON.parse(text) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error(`${path} must contain a JSON object`);
	for (const [name, value] of Object.entries(parsed)) {
		if (name === SUPPRESS_KEY) {
			if (typeof value !== "boolean")
				throw new Error(`${path} ${SUPPRESS_KEY} must be a boolean`);
		} else if (typeof value !== "string") {
			throw new Error(`${path} version for ${name} must be a string`);
		}
	}
	return parsed as ChangelogState;
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (true) {
		try {
			await mkdir(path);
			return () => rm(path, { force: true, recursive: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const info = await stat(path).catch(() => undefined);
			if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
				await rm(path, { force: true, recursive: true });
				continue;
			}
			if (Date.now() >= deadline)
				throw new Error(`Timed out waiting for ${path}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}
}

async function writeState(path: string, state: ChangelogState): Promise<void> {
	await mkdir(dirname(path), { mode: 0o700, recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const ordered = Object.fromEntries(
			Object.entries(state).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		);
		await writeFile(temporaryPath, `${JSON.stringify(ordered, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

function packageMarkdown(
	registration: PackageRegistration,
	entries: ChangelogEntry[],
): string {
	const body = (entry: ChangelogEntry) =>
		entry.content
			.replace(/^##[^\n]*\n*/, "")
			.replace(/^###\s+(?:Changes|Minor Changes|Patch Changes)\s*\n*/gim, "")
			.replace(/^###\s+(.+)$/gm, "**$1**");
	if (entries.length === 1) {
		const [entry] = entries;
		if (!entry) return "";
		return `## ${registration.name} ${entry.version}\n\n${body(entry)}`;
	}
	return [
		`## ${registration.name}`,
		...entries.map((entry) => `**${entry.version}**\n\n${body(entry)}`),
	].join("\n\n");
}

async function claimUpdates(
	registrations: Iterable<PackageRegistration>,
): Promise<{ errors: string[]; markdown?: string }> {
	const stableRegistrations = [...registrations]
		.filter((registration) => isStableVersion(registration.version))
		.sort((left, right) => left.name.localeCompare(right.name));
	if (stableRegistrations.length === 0) return { errors: [] };
	const path = statePath();
	await mkdir(dirname(path), { mode: 0o700, recursive: true });
	const release = await acquireLock(`${path}.lock`);
	try {
		const state = await readState(path);
		const errors: string[] = [];
		const sections: string[] = [];
		let changed = false;
		if (state[SUPPRESS_KEY] === true) {
			for (const registration of stableRegistrations) {
				const seenVersion = state[registration.name];
				if (
					typeof seenVersion !== "string" ||
					compareVersions(registration.version, seenVersion) > 0
				) {
					state[registration.name] = registration.version;
					changed = true;
				}
			}
			if (changed) await writeState(path, state);
			return { errors };
		}
		for (const registration of stableRegistrations) {
			const seenVersion = state[registration.name];
			if (
				typeof seenVersion === "string" &&
				compareVersions(registration.version, seenVersion) <= 0
			)
				continue;
			try {
				const entries = parseChangelog(
					await readFile(registration.changelogPath, "utf8"),
				).filter(
					(entry) =>
						compareVersions(entry.version, registration.version) <= 0 &&
						(typeof seenVersion === "string"
							? compareVersions(entry.version, seenVersion) > 0
							: entry.version === registration.version),
				);
				if (entries.length === 0) {
					errors.push(
						`No ${registration.version} changelog entry found for ${registration.name}`,
					);
					continue;
				}
				sections.push(packageMarkdown(registration, entries));
				state[registration.name] = registration.version;
				changed = true;
			} catch (error) {
				errors.push(
					`Could not read the ${registration.name} changelog: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (changed) await writeState(path, state);
		return {
			errors,
			...(sections.length > 0 ? { markdown: sections.join("\n\n") } : {}),
		};
	} finally {
		await release();
	}
}

function registerCoordinator(
	pi: ExtensionAPI,
	registration: PackageRegistration,
): void {
	let accepted = false;
	pi.events.emit(REGISTRATION_CHANNEL, {
		registration,
		accept: () => {
			accepted = true;
		},
	} satisfies RegistrationEvent);
	if (accepted) return;

	const registrations = new Map([[registration.name, registration]]);
	pi.events.on(REGISTRATION_CHANNEL, (value) => {
		if (!isRegistrationEvent(value)) return;
		registrations.set(value.registration.name, value.registration);
		value.accept();
	});
	pi.registerEntryRenderer<ChangelogEntryData>(
		ENTRY_TYPE,
		(entry, _options, theme) => {
			if (!entry.data) return undefined;
			const container = new Container();
			container.addChild(new DynamicBorder());
			container.addChild(
				new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0),
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
		try {
			const update = await claimUpdates(registrations.values());
			if (update.markdown)
				pi.appendEntry<ChangelogEntryData>(ENTRY_TYPE, {
					markdown: update.markdown,
				});
			for (const error of update.errors) ctx.ui.notify(error, "warning");
		} catch (error) {
			ctx.ui.notify(
				`Could not update Howaboua changelog state: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});
}

export default function howabouaPackageChangelog(pi: ExtensionAPI): void {
	registerCoordinator(pi, packageRegistration());
}
