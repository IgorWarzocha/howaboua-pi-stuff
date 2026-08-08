export const DENO_VERSION = "2.9.5";

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
		archiveSha256: "8b010a3b1a4a0188a67cdb8a7a27348b2a501af78aec7fc74f2ace167368d530",
		archiveBytes: 41_638_854,
		executable: "deno",
		binarySha256: "dc480c462c8c3582524f3e75c160613d0a975e1f66b5465995d58bae236da7d3",
		binaryBytes: 95_582_008,
	},
	"linux-arm64": {
		archive: "deno-aarch64-unknown-linux-gnu.zip",
		archiveSha256: "6b7cae3a8fc4385a59dea3146fcb8bad7fea4230e0ad36a8c692afacbc254be0",
		archiveBytes: 39_902_077,
		executable: "deno",
		binarySha256: "e1a70c5eb03b0ebaf761077029ef86b9ba22d50e2b54ca45ce5437457f701b63",
		binaryBytes: 84_842_080,
	},
	"darwin-x64": {
		archive: "deno-x86_64-apple-darwin.zip",
		archiveSha256: "c1b8b89a81e91b2a8b3f96def3195d08cfe3a105651da7908d53061f7140510d",
		archiveBytes: 42_346_648,
		executable: "deno",
		binarySha256: "befc4fee79127584c0f5c9f76ca6bb73c8e6ff523c01acd52e9c5db1968a09cb",
		binaryBytes: 97_740_224,
	},
	"darwin-arm64": {
		archive: "deno-aarch64-apple-darwin.zip",
		archiveSha256: "b796aadd131f6930560c1ee040cf0d6f53933fbb987464e9ff46bd7ea4830615",
		archiveBytes: 38_511_993,
		executable: "deno",
		binarySha256: "b5bd08edab254d42d7b05aa5b6cb4c9b8d4dede4975aff76951ce2cce18866fa",
		binaryBytes: 80_900_512,
	},
	"win32-x64": {
		archive: "deno-x86_64-pc-windows-msvc.zip",
		archiveSha256: "171efab55ac6b9881fd53ee4c20f8bf3bb1340ffc618483746909014db12216a",
		archiveBytes: 42_691_248,
		executable: "deno.exe",
		binarySha256: "98f8c2a2d470e4ccb04c935c86ff8050817d877762aec5eaeeb9e409ccb3b9fd",
		binaryBytes: 97_408_288,
	},
	"win32-arm64": {
		archive: "deno-aarch64-pc-windows-msvc.zip",
		archiveSha256: "73f20b3566a0a6e3f6912fd7bf5b3a7ccd04d68414baedea3b397437bdec6472",
		archiveBytes: 40_905_829,
		executable: "deno.exe",
		binarySha256: "ec503fba3b205fd47777d0e90e84ac7ae74d45d94041b46d31b414894c52ad3b",
		binaryBytes: 88_836_384,
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
