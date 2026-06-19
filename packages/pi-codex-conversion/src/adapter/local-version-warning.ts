import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "@howaboua/pi-codex-conversion";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@howaboua%2Fpi-codex-conversion";
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

interface PackageJsonLike {
	name?: string | undefined;
	version?: string | undefined;
}

interface NpmRegistryPackageLike {
	"dist-tags"?: { latest?: string | undefined } | undefined;
}

export function isLocalCheckoutPath(path: string): boolean {
	return !path.split(/[\\/]/).includes("node_modules");
}

export function compareSemverLike(left: string, right: string): number {
	const leftParts = parseSemverLike(left);
	const rightParts = parseSemverLike(right);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
		const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (delta !== 0) return delta;
	}
	return 0;
}

export function formatLocalCheckoutUpdateWarning(currentVersion: string, latestVersion: string): string {
	return `${PACKAGE_NAME} local checkout is behind npm (${currentVersion} < ${latestVersion}). Update the checkout to the latest release or switch back to the npm package.`;
}

function parseSemverLike(value: string): number[] {
	return value.split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
}

function readPackageJson(packageRoot: string): PackageJsonLike | undefined {
	try {
		return JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as PackageJsonLike;
	} catch {
		return undefined;
	}
}

async function fetchLatestNpmVersion(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
	const response = await fetchImpl(NPM_REGISTRY_URL, { signal: AbortSignal.timeout(2_000) });
	if (!response.ok) return undefined;
	const json = await response.json() as NpmRegistryPackageLike;
	return json["dist-tags"]?.latest;
}

export async function maybeWarnLocalCheckoutVersion(ctx: ExtensionContext, options: { packageRoot?: string | undefined; fetchImpl?: typeof fetch | undefined } = {}): Promise<void> {
	const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
	if (!isLocalCheckoutPath(packageRoot)) return;
	const packageJson = readPackageJson(packageRoot);
	if (packageJson?.name !== PACKAGE_NAME || !packageJson.version) return;
	try {
		const latestVersion = await fetchLatestNpmVersion(options.fetchImpl);
		if (!latestVersion || compareSemverLike(packageJson.version, latestVersion) >= 0) return;
		ctx.ui.notify(formatLocalCheckoutUpdateWarning(packageJson.version, latestVersion), "warning");
	} catch {
		return;
	}
}
