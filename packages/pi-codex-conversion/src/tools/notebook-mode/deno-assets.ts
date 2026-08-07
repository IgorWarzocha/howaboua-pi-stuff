export const DENO_VERSION = "2.9.5";

const LINUX_X64_ASSET = "deno-x86_64-unknown-linux-gnu.zip";
const LINUX_X64_SHA256 = "8b010a3b1a4a0188a67cdb8a7a27348b2a501af78aec7fc74f2ace167368d530";
const LINUX_X64_BINARY_SHA256 = "dc480c462c8c3582524f3e75c160613d0a975e1f66b5465995d58bae236da7d3";
const LINUX_X64_BINARY_BYTES = 95_582_008;

export function resolveDenoAsset(platform: string, arch: string): readonly [string, string, string, number] {
	if (platform !== "linux" || arch !== "x64") {
		throw new Error(`Notebook Code Mode prototype supports linux-x64 only; got ${platform}-${arch}`);
	}
	return [LINUX_X64_ASSET, LINUX_X64_SHA256, LINUX_X64_BINARY_SHA256, LINUX_X64_BINARY_BYTES];
}

export function denoAssetUrl(asset: string): string {
	return `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${asset}`;
}
