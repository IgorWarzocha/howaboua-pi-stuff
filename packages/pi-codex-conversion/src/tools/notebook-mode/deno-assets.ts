export const DENO_VERSION = "2.9.7";

export interface DenoAsset {
	archive: string;
	archiveSha256: string;
	archiveBytes: number;
	executable: "deno" | "deno.exe";
	binarySha256: string;
	binaryBytes: number;
}

const ASSETS: Record<string, DenoAsset> = {
	"linux-x64": {
		archive: "deno-x86_64-unknown-linux-gnu.zip",
		archiveSha256: "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490",
		archiveBytes: 41_596_794,
		executable: "deno",
		binarySha256: "ce6a052beb97c2b92de67077e3f3924ba7c9661ede0d8dc2f66a116a3c841f21",
		binaryBytes: 95_830_104,
	},
	"linux-arm64": {
		archive: "deno-aarch64-unknown-linux-gnu.zip",
		archiveSha256: "c832298b1ad4422481334855f6003e0f54145762c5a134f20a489511d2f65bbf",
		archiveBytes: 39_821_318,
		executable: "deno",
		binarySha256: "5ecc9a6b862d61d4cf8cae3ac5f29488ffc839d675cfd60c11d908121dfe5bf1",
		binaryBytes: 84_971_392,
	},
	"darwin-x64": {
		archive: "deno-x86_64-apple-darwin.zip",
		archiveSha256: "95daaff11c116a52ad54785e7914c8e9c9cdcaba793c5ed929c74ca2d8e6259a",
		archiveBytes: 42_295_422,
		executable: "deno",
		binarySha256: "325cf9c4b7156f4efd96ad22177a276a4bf4384147d4c9d9f40f9caee28e5719",
		binaryBytes: 97_829_808,
	},
	"darwin-arm64": {
		archive: "deno-aarch64-apple-darwin.zip",
		archiveSha256: "5cd46d6268f6f78f5d88bdc7159d20bd44cdaa4b3303474839f87ec6fe7ae25c",
		archiveBytes: 38_469_316,
		executable: "deno",
		binarySha256: "b73737579d5a84c160e3316487594783fa5c15f4e13252a6a07050b755317f1a",
		binaryBytes: 80_982_000,
	},
	"win32-x64": {
		archive: "deno-x86_64-pc-windows-msvc.zip",
		archiveSha256: "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238",
		archiveBytes: 42_630_221,
		executable: "deno.exe",
		binarySha256: "e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33",
		binaryBytes: 97_462_048,
	},
	"win32-arm64": {
		archive: "deno-aarch64-pc-windows-msvc.zip",
		archiveSha256: "c4c4ac8bfdaa37814bda5c05fc9cdf2154904e2ef8277673a30bdceaaa649807",
		archiveBytes: 40_847_024,
		executable: "deno.exe",
		binarySha256: "970a5255e78f436abed194017648f8a5ab8135cbd95702ec803123c60b6a5cc0",
		binaryBytes: 88_891_168,
	},
};

export function resolveDenoAsset(platform: string, arch: string): DenoAsset {
	const asset = ASSETS[`${platform}-${arch}`];
	if (!asset) throw new Error(`Notebook Code Mode does not support ${platform}-${arch}`);
	return asset;
}

export function denoAssetUrl(asset: string): string {
	return `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${asset}`;
}
