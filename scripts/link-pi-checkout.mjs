#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 1) {
	console.error("Usage: bun run pi:link-checkout -- <pi-checkout>");
	process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages/pi-codex-conversion");
const checkout = realpathSync(resolve(args[0]));
const packageSpecs = [
	["@earendil-works/pi-ai", "ai"],
	["@earendil-works/pi-agent-core", "agent"],
	["@earendil-works/pi-tui", "tui"],
	["@earendil-works/pi-coding-agent", "coding-agent"],
	["@earendil-works/pi-server", "server"],
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const checkoutManifest = readJson(join(checkout, "package.json"));
if (checkoutManifest.name !== "pi-monorepo") {
	throw new Error(`${checkout} is not a Pi monorepo checkout`);
}

const packages = new Map();
for (const [name, directory] of packageSpecs) {
	const root = join(checkout, "packages", directory);
	const manifest = readJson(join(root, "package.json"));
	if (manifest.name !== name) {
		throw new Error(
			`Expected ${name} at ${root}, found ${manifest.name ?? "an unnamed package"}`,
		);
	}
	if (
		typeof manifest.main !== "string" ||
		!existsSync(join(root, manifest.main))
	) {
		throw new Error(
			`${name} has not been built: missing ${manifest.main ?? "main entry"}`,
		);
	}
	packages.set(name, { root, manifest });
}

const ai = packages.get("@earendil-works/pi-ai");
const aiEntry = ai.manifest.exports?.["."]?.import;
if (typeof aiEntry !== "string" || !existsSync(join(ai.root, aiEntry))) {
	throw new Error("The built @earendil-works/pi-ai export is missing");
}
const aiModule = await import(pathToFileURL(join(ai.root, aiEntry)).href);
const transcriptExports = [
	"getCurrentSystemMessage",
	"getCurrentSystemPrompt",
	"getDeclaredTools",
	"getInitialSystemMessage",
	"normalizeContext",
	"resolveTranscript",
	"resolveTranscriptTools",
];
const missingTranscriptExports = transcriptExports.filter(
	(name) => typeof aiModule[name] !== "function",
);
if (missingTranscriptExports.length > 0) {
	throw new Error(
		`Built Pi checkout lacks transcript exports: ${missingTranscriptExports.join(", ")}`,
	);
}

const codingAgent = packages.get("@earendil-works/pi-coding-agent");
const cliEntry = codingAgent.manifest.bin?.pi;
if (
	typeof cliEntry !== "string" ||
	!existsSync(join(codingAgent.root, cliEntry))
) {
	throw new Error("The built Pi CLI is missing");
}

const roots = [repoRoot, packageRoot];
const plans = roots.flatMap((root, index) =>
	packageSpecs
		.filter(([name]) => index === 0 || name !== "@earendil-works/pi-server")
		.map(([name]) => ({
			name,
			source: packages.get(name).root,
			target: join(root, "node_modules", ...name.split("/")),
		})),
);

function stat(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return undefined;
		throw error;
	}
}

for (const { name, target } of plans) {
	const current = stat(target);
	if (!current || current.isSymbolicLink()) continue;
	if (!current.isDirectory())
		throw new Error(`Refusing to replace non-directory ${target}`);
	const installedManifest = readJson(join(target, "package.json"));
	if (installedManifest.name !== name) {
		throw new Error(
			`Refusing to replace ${target}: package name is ${installedManifest.name ?? "missing"}`,
		);
	}
}

const pending = plans.filter(({ source, target }) => {
	try {
		return realpathSync(target) !== realpathSync(source);
	} catch {
		return true;
	}
});
const token = `${process.pid}-${randomUUID()}`;
const applied = [];

try {
	for (const plan of pending) {
		const parent = dirname(plan.target);
		const basename = plan.target.slice(parent.length + 1);
		const staged = join(parent, `.${basename}.pi-checkout-${token}`);
		const backup = join(parent, `.${basename}.pi-checkout-backup-${token}`);
		mkdirSync(parent, { recursive: true });
		const linkSource =
			process.platform === "win32"
				? plan.source
				: relative(parent, plan.source);
		symlinkSync(
			linkSource,
			staged,
			process.platform === "win32" ? "junction" : "dir",
		);
		if (stat(plan.target)) renameSync(plan.target, backup);
		try {
			renameSync(staged, plan.target);
		} catch (error) {
			if (stat(backup)) renameSync(backup, plan.target);
			throw error;
		}
		applied.push({ ...plan, backup });
	}
} catch (error) {
	for (const { target, backup } of applied.reverse()) {
		rmSync(target, { force: true, recursive: true });
		if (stat(backup)) renameSync(backup, target);
	}
	throw error;
}

for (const { backup } of applied)
	rmSync(backup, { force: true, recursive: true });
console.log(
	`Linked ${plans.length} local Pi dependencies to ${checkout}\nValidated transcript API and CLI ${join(codingAgent.root, cliEntry)}`,
);
