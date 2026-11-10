export const HOST_RELEASE = "rust-v0.167.0";

export const HOST_ASSETS = {
	"darwin-arm64": [
		"codex-code-mode-host-aarch64-apple-darwin.tar.gz",
		"876a3e263348ef0edaeae5cf5bc52a5c121141cefd15157ab0eeca305f3eb563",
	],
	"darwin-x64": [
		"codex-code-mode-host-x86_64-apple-darwin.tar.gz",
		"612d0dc2c7316fbf05ee922796f4d740a285b76a55d4c78e1b946ba621bdcc91",
	],
	"linux-arm64": [
		"codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz",
		"6e99948fa20ca816a01f222a56afa261b321e00cbed611d76bb92c765fd11ec6",
	],
	"linux-x64": [
		"codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz",
		"b5074d5dd64643b2c073927e494a588eff31c1f5a27f12c1e2c45f9a6cf07dd4",
	],
	"win32-arm64": [
		"codex-code-mode-host-aarch64-pc-windows-msvc.exe",
		"2b0eb23a9b0e2991ba54e509dacf0d753131255328c6e1042869c902b6eb5f27",
	],
	"win32-x64": [
		"codex-code-mode-host-x86_64-pc-windows-msvc.exe",
		"5acd42f62966dd4a498ebfe04c5cae4c4a644a342a65a21bb53f8f36235c3d35",
	],
} as const;

export function codeModeHostBinaryName(platform: string): string {
	return platform === "win32" ? "codex-code-mode-host.exe" : "codex-code-mode-host";
}

export function resolveCodeModeHostAsset(platform: string, arch: string): readonly [string, string] {
	const asset = (HOST_ASSETS as Record<string, readonly [string, string]>)[`${platform}-${arch}`];
	if (!asset) throw new Error(`Unsupported code-mode platform: ${platform}-${arch}`);
	return asset;
}

export function hostAssetUrl(assetName: string): string {
	return `https://github.com/openai/codex/releases/download/${HOST_RELEASE}/${assetName}`;
}
