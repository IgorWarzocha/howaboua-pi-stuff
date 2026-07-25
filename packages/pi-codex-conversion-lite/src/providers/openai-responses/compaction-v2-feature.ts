import type { ProviderHeaders } from "@earendil-works/pi-ai";

export const REMOTE_COMPACTION_V2_FEATURE = "remote_compaction_v2";

export function withRemoteCompactionV2Feature(headers: ProviderHeaders | undefined): ProviderHeaders {
	const merged = new Headers();
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (value !== null) merged.set(name, value);
	}
	const features = (merged.get("x-codex-beta-features") ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (!features.includes(REMOTE_COMPACTION_V2_FEATURE)) features.push(REMOTE_COMPACTION_V2_FEATURE);
	merged.set("x-codex-beta-features", features.join(","));
	return Object.fromEntries(merged.entries());
}
