import type { ProviderHeaders } from "@earendil-works/pi-ai";

export const REMOTE_COMPACTION_V2_FEATURE = "remote_compaction_v2";

export function withRemoteCompactionV2Feature(headers: ProviderHeaders | undefined): ProviderHeaders {
	const merged: ProviderHeaders = { ...headers };
	for (const name of Object.keys(merged)) {
		if (name.toLowerCase() === "x-codex-beta-features") delete merged[name];
	}
	const configured = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "x-codex-beta-features")?.[1];
	const features = (configured ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (!features.includes(REMOTE_COMPACTION_V2_FEATURE)) features.push(REMOTE_COMPACTION_V2_FEATURE);
	merged["x-codex-beta-features"] = features.join(",");
	return merged;
}
