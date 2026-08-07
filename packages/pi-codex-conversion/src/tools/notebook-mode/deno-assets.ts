export const DENO_VERSION = "2.9.5";

const LINUX_X64_ASSET = "deno-x86_64-unknown-linux-gnu.zip";
const LINUX_X64_SHA256 = "8b010a3b1a4a0188a67cdb8a7a27348b2a501af78aec7fc74f2ace167368d530";

export function resolveDenoAsset(platform: string, arch: string): readonly [string, string] {
	if (platform !== "linux" || arch !== "x64") {
		throw new Error(`Notebook Code Mode prototype supports linux-x64 only; got ${platform}-${arch}`);
	}
	return [LINUX_X64_ASSET, LINUX_X64_SHA256];
}

export function denoAssetUrl(asset: string): string {
	return `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${asset}`;
}
