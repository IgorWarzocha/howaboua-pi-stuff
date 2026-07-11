export const HOST_RELEASE = "rust-v0.144.1";

export const HOST_ASSETS = {
	"darwin-arm64": [
		"codex-code-mode-host-aarch64-apple-darwin.tar.gz",
		"00ada1cadcf4de913dd44721f26182ab03686a0456daeae324829fbaf50d2894",
	],
	"darwin-x64": [
		"codex-code-mode-host-x86_64-apple-darwin.tar.gz",
		"8cfe0269058406648f5d593cbc65afbc1804ae3527256f0ef5590214aafbfd97",
	],
	"linux-arm64": [
		"codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz",
		"0612614df9aa45c36c7463419fe3c46e7a1d37f4ced1be9c6e89cdcc34c058e7",
	],
	"linux-x64": [
		"codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz",
		"189addf0be16a8469540931c78a0d27675f64e05f659a65c7d558138383dd25f",
	],
	"win32-arm64": [
		"codex-code-mode-host-aarch64-pc-windows-msvc.exe",
		"50da9a41d2766e42f07e30c82241ddef34b8473211ffa59db6e3a6adc46b227e",
	],
	"win32-x64": [
		"codex-code-mode-host-x86_64-pc-windows-msvc.exe",
		"36e6bf90f70439a03cd7f2852242fe5f952b87cd6480540aefa6b150c18b8772",
	],
};

export function hostAssetUrl(assetName) {
	return `https://github.com/openai/codex/releases/download/${HOST_RELEASE}/${assetName}`;
}
