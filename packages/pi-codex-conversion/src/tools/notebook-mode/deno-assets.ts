export const DENO_VERSION = "2.9.8";

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
		archiveSha256: "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609",
		archiveBytes: 41_963_064,
		executable: "deno",
		binarySha256: "368bca08999e02c6911b8f248167b582276b1f547db5712b6e736d7eda1dbda7",
		binaryBytes: 96_055_992,
	},
	"linux-arm64": {
		archive: "deno-aarch64-unknown-linux-gnu.zip",
		archiveSha256: "d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905",
		archiveBytes: 40_120_596,
		executable: "deno",
		binarySha256: "b484f780e5149ca05c673f1f79f7fb466f12a2295933bdad917af4a8a5c020e8",
		binaryBytes: 85_561_832,
	},
	"darwin-x64": {
		archive: "deno-x86_64-apple-darwin.zip",
		archiveSha256: "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
		archiveBytes: 42_797_031,
		executable: "deno",
		binarySha256: "5d206ba69742549cc161db06e86f1d93c5622e1dbc8ba9d15a618e538fbc92f4",
		binaryBytes: 98_799_200,
	},
	"darwin-arm64": {
		archive: "deno-aarch64-apple-darwin.zip",
		archiveSha256: "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
		archiveBytes: 38_770_795,
		executable: "deno",
		binarySha256: "d1e99265e5e6ee096c5780d88ff7d3e6cfdf33b1953a118b4889cab8ca6980ba",
		binaryBytes: 81_512_928,
	},
	"win32-x64": {
		archive: "deno-x86_64-pc-windows-msvc.zip",
		archiveSha256: "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
		archiveBytes: 42_917_472,
		executable: "deno.exe",
		binarySha256: "924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266",
		binaryBytes: 98_081_568,
	},
	"win32-arm64": {
		archive: "deno-aarch64-pc-windows-msvc.zip",
		archiveSha256: "b413b92b735b50c198e8fe3b85af1aa50e29d5f72e229aab701d132286e14cef",
		archiveBytes: 41_163_152,
		executable: "deno.exe",
		binarySha256: "40d161bc35657cc7432a2e3832290922939cd63fddd29f66db2261d291e42478",
		binaryBytes: 89_512_224,
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
