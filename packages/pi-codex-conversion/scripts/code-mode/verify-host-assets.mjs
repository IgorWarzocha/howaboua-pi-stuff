#!/usr/bin/env node

import { createHash } from "node:crypto";
import { HOST_ASSETS, HOST_RELEASE, hostAssetUrl } from "./host-assets.mjs";

for (const [platform, [assetName, expectedSha256]] of Object.entries(
	HOST_ASSETS,
)) {
	const response = await fetch(hostAssetUrl(assetName), { redirect: "follow" });
	if (!response.ok)
		throw new Error(
			`${platform}: download failed: ${response.status} ${response.statusText}`,
		);
	const bytes = Buffer.from(await response.arrayBuffer());
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expectedSha256)
		throw new Error(`${platform}: checksum mismatch for ${assetName}`);
	console.log(`${platform}: ${assetName} verified`);
}

console.log(`All ${HOST_RELEASE} code-mode host assets verified.`);
