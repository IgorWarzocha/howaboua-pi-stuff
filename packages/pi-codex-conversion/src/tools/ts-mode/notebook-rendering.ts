import {
	auxiliaryToolRenderers,
	displayRecord,
	inlineToolText,
} from "../../ui/tool-rendering/auxiliary-tool.ts";

const TITLES: Record<string, { active: string; complete: string }> = {
	help: { active: "Reading notebook help", complete: "Read notebook help" },
	status: { active: "Checking notebook", complete: "Checked notebook" },
	list: {
		active: "Listing notebook profiles",
		complete: "Listed notebook profiles",
	},
	checkpoint: {
		active: "Checkpointing notebook",
		complete: "Checkpointed notebook",
	},
	save: {
		active: "Saving notebook profile",
		complete: "Saved notebook profile",
	},
	load: {
		active: "Loading notebook profile",
		complete: "Loaded notebook profile",
	},
	pin: {
		active: "Pinning notebook bindings",
		complete: "Pinned notebook bindings",
	},
	unpin: {
		active: "Unpinning notebook bindings",
		complete: "Unpinned notebook bindings",
	},
	release: {
		active: "Releasing notebook bindings",
		complete: "Released notebook bindings",
	},
	prune: {
		active: "Pruning notebook state",
		complete: "Pruned notebook state",
	},
	restart: { active: "Restarting notebook", complete: "Restarted notebook" },
	diagnostics: {
		active: "Diagnosing notebook",
		complete: "Diagnosed notebook",
	},
	reset: { active: "Resetting notebook", complete: "Reset notebook" },
};

export const notebookRenderers = auxiliaryToolRenderers(
	"Notebook operation failed",
	(args, result) => {
		if (Object.keys(args).length === 0) args = { action: "help" };
		if (typeof args["input"] === "string") {
			if (args["input"] === "help") args = { action: "help" };
			else {
				try {
					args = displayRecord(JSON.parse(args["input"]));
				} catch {}
			}
		}
		const action = String(args["action"] ?? "");
		const titles = TITLES[action] ?? {
			active: "Controlling notebook",
			complete: "Controlled notebook",
		};
		const target = inlineToolText(
			args["name"] ??
				(Array.isArray(args["names"])
					? args["names"].join(", ")
					: args["query"]),
		);
		if (!result) return { ...titles, target };
		const details = displayRecord(result.details);
		const facts: string[] = [];
		const warnings: string[] = [];
		const count = (
			value: unknown,
			singular: string,
			plural = `${singular}s`,
		) => {
			if (typeof value === "number")
				facts.push(`${value} ${value === 1 ? singular : plural}`);
		};
		if (action === "status") {
			count(details["retainedBindings"], "retained binding");
			count(details["pinnedBindings"], "pinned", "pinned");
		}
		if (action === "list" && Array.isArray(details["profiles"]))
			count(details["profiles"].length, "saved profile");
		if (action === "reset")
			warnings.push("Session checkpoint discarded · profiles preserved");
		return {
			...titles,
			target,
			summary: facts.join(" · ") || undefined,
			warning: warnings.join("\n") || undefined,
		};
	},
);
