import { sleep } from "./discovery.js";
import type { CdpConnection, PageInfo } from "./types.js";
import { asRecord, asString } from "./types.js";

function pageInfo(value: unknown): PageInfo {
	const record = asRecord(value, "CDP target");
	return {
		targetId: asString(record["targetId"], "targetId"),
		title: typeof record["title"] === "string" ? record["title"] : "",
		url: asString(record["url"], "target URL"),
		...(typeof record["type"] === "string" ? { type: record["type"] } : {}),
	};
}

export async function getPages(
	cdp: CdpConnection,
	signal?: AbortSignal,
): Promise<PageInfo[]> {
	const response = asRecord(
		await cdp.send("Target.getTargets", {}, undefined, signal),
		"Target.getTargets response",
	);
	const targetInfos = response["targetInfos"];
	if (!Array.isArray(targetInfos)) {
		throw new Error("Target.getTargets response has no targetInfos");
	}
	return targetInfos
		.map(pageInfo)
		.filter(
			(target) => target.type === "page" && !target.url.startsWith("chrome://"),
		);
}

export async function waitForOpenedTarget(
	cdp: CdpConnection,
	targetId: string,
	requestedUrl: string,
	timeout = 5_000,
	signal?: AbortSignal,
): Promise<PageInfo> {
	if (requestedUrl === "about:blank") {
		return {
			targetId,
			title: requestedUrl,
			url: requestedUrl,
			type: "page",
		};
	}
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const response = asRecord(
			await cdp.send("Target.getTargetInfo", { targetId }, undefined, signal),
			"Target.getTargetInfo response",
		);
		const target = pageInfo(response["targetInfo"]);
		if (target.url && target.url !== "about:blank") return target;
		await sleep(100, signal);
	}
	throw new Error(`New tab did not begin navigating to ${requestedUrl}`);
}
