import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const PACKAGE_NAME = "@howaboua/pi-codex-conversion";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@howaboua%2Fpi-codex-conversion";
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export function isLocalCheckoutPath(path) {
    return !path.split(/[\\/]/).includes("node_modules");
}
export function compareSemverLike(left, right) {
    const leftParts = parseSemverLike(left);
    const rightParts = parseSemverLike(right);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
        const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (delta !== 0)
            return delta;
    }
    return 0;
}
export function formatLocalCheckoutUpdateWarning(currentVersion, latestVersion) {
    return `${PACKAGE_NAME} local checkout is behind npm (${currentVersion} < ${latestVersion}). Update the checkout to the latest release or switch back to the npm package.`;
}
function parseSemverLike(value) {
    return value.split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
}
function readPackageJson(packageRoot) {
    try {
        return JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8"));
    }
    catch {
        return undefined;
    }
}
async function fetchLatestNpmVersion(fetchImpl = fetch) {
    const response = await fetchImpl(NPM_REGISTRY_URL, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok)
        return undefined;
    const json = await response.json();
    return json["dist-tags"]?.latest;
}
export async function maybeWarnLocalCheckoutVersion(ctx, options = {}) {
    const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
    if (!isLocalCheckoutPath(packageRoot))
        return;
    const packageJson = readPackageJson(packageRoot);
    if (packageJson?.name !== PACKAGE_NAME || !packageJson.version)
        return;
    try {
        const latestVersion = await fetchLatestNpmVersion(options.fetchImpl);
        if (!latestVersion || compareSemverLike(packageJson.version, latestVersion) >= 0)
            return;
        ctx.ui.notify(formatLocalCheckoutUpdateWarning(packageJson.version, latestVersion), "warning");
    }
    catch {
        return;
    }
}
