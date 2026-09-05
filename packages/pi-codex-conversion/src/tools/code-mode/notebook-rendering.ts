import {
	auxiliaryToolRenderers,
	displayRecord,
	inlineToolText,
} from "../../ui/tool-rendering/auxiliary-tool.ts";

const TITLES: Record<string, { active: string; complete: string }> = {
	status: { active: "Checking notebook", complete: "Checked notebook" },
	list: { active: "Listing notebook profiles", complete: "Listed notebook profiles" },
	checkpoint: { active: "Checkpointing notebook", complete: "Checkpointed notebook" },
	save: { active: "Saving notebook profile", complete: "Saved notebook profile" },
	load: { active: "Loading notebook profile", complete: "Loaded notebook profile" },
	pin: { active: "Pinning notebook bindings", complete: "Pinned notebook bindings" },
	unpin: { active: "Unpinning notebook bindings", complete: "Unpinned notebook bindings" },
	release: { active: "Releasing notebook bindings", complete: "Released notebook bindings" },
	prune: { active: "Pruning notebook state", complete: "Pruned notebook state" },
	restart: { active: "Restarting notebook", complete: "Restarted notebook" },
	diagnostics: { active: "Diagnosing notebook", complete: "Diagnosed notebook" },
	reset: { active: "Resetting notebook", complete: "Reset notebook" },
};

export const notebookRenderers = auxiliaryToolRenderers("Notebook operation failed", (args, result) => {
	const action = String(args["action"] ?? "");
	const titles = TITLES[action] ?? { active: "Controlling notebook", complete: "Controlled notebook" };
	const target = inlineToolText(args["name"] ?? (Array.isArray(args["names"]) ? args["names"].join(", ") : args["query"]));
	if (!result) return { ...titles, target };
	const details = displayRecord(result.details);
	const facts: string[] = [];
	const warnings: string[] = [];
	const count = (value: unknown, singular: string, plural = `${singular}s`) => {
		if (typeof value === "number") facts.push(`${value} ${value === 1 ? singular : plural}`);
	};
	switch (action) {
		case "status": {
			if (Array.isArray(details["matches"])) count(details["matches"].length + (typeof details["omittedMatches"] === "number" ? details["omittedMatches"] : 0), "match", "matches");
			count(details["retainedBindings"], "retained binding");
			count(details["pinnedBindings"], "pinned", "pinned");
			const memory = displayRecord(details["memory"]);
			const heap = memory["heapUsedBytes"];
			const limit = memory["heapLimitBytes"];
			if (typeof heap === "number") facts.push(`${Math.round(heap / 1024 ** 2)} MiB heap`);
			if (typeof heap === "number" && typeof limit === "number" && limit > 0 && heap / limit >= 0.8) warnings.push(`Heap at ${Math.round(heap / limit * 100)}% of limit`);
			if (details["state"] === "running") warnings.push(`Cell running${inlineToolText(details["activeCell"]) ? `: ${inlineToolText(details["activeCell"])}` : ""}`);
			if (displayRecord(details["checkpoint"])["dirty"] === true) warnings.push("Checkpoint pending");
			break;
		}
		case "list":
			if (Array.isArray(details["profiles"])) count(details["profiles"].length, "saved profile");
			break;
		case "checkpoint": count(details["projectBindings"], "durable binding"); break;
		case "pin": case "unpin": count(details["bindingCount"], "binding"); break;
		case "release": case "prune":
			count(details["releasedCount"], "binding released", "bindings released");
			count(details["protectedCount"], "pinned binding preserved", "pinned bindings preserved");
			if (details["restarted"] === true) warnings.push("Kernel restarted · runtime-only handles cleared");
			if (typeof details["failureCount"] === "number" && details["failureCount"] > 0) warnings.push(`${details["failureCount"]} cleanup/release failures`);
			break;
		case "save": case "load": {
			const profile = action === "load" ? displayRecord(details["summary"]) : details;
			count(profile["values"], "value");
			count(profile["definitions"], "definition");
			if (typeof profile["skipped"] === "number" && profile["skipped"] > 0) warnings.push(`${profile["skipped"]} skipped`);
			break;
		}
		case "reset":
			count(details["preservedProjectBindings"], "project binding preserved", "project bindings preserved");
			warnings.push("Session checkpoint discarded · profiles preserved");
			break;
		case "diagnostics":
			count(details["diagnosticCount"], "historical diagnostic");
			if (displayRecord(details["runtime"])["state"] === "invalidated") warnings.push("Runtime invalidated");
			if (typeof details["error"] === "string") warnings.push(details["error"]);
			break;
	}
	if (typeof details["terminatedCell"] === "string") warnings.push(`Terminated cell ${inlineToolText(details["terminatedCell"])}`);
	if (Array.isArray(details["disposalFailures"]) && details["disposalFailures"].length > 0) warnings.push(`${details["disposalFailures"].length} resource cleanup failures`);
	if (typeof details["restoreNotice"] === "string") warnings.push(details["restoreNotice"]);
	return { ...titles, target, summary: facts.join(" · ") || undefined, warning: warnings.join("\n") || undefined };
});
