import { getSnapshot, parsePaneInfo, resolveWorkspace } from "./herdr.js";
import type { HerdrConnection } from "./herdr-client.js";
import {
	type CreatedLocationCleanup,
	RolledBackAgentLaunchError,
	requiredStartField,
	type StartAgentParams,
	UnstartedAgentLaunchError,
} from "./launch-contract.js";
import type { PaneInfo } from "./types.js";

export async function createStartPane(
	client: HerdrConnection,
	params: StartAgentParams,
	cwd: string,
	label: string,
): Promise<{
	cleanup?: CreatedLocationCleanup;
	paneId: string;
}> {
	const placement = params.placement;
	if (!placement) throw new Error("placement is required for start");
	if (placement === "terminal")
		throw new UnstartedAgentLaunchError(
			"terminal placement requires Core; use new_tab or new_workspace in legacy Herdr",
		);
	if (placement === "pane") {
		return { paneId: requiredStartField(params.pane, "pane") };
	}
	if (placement === "new_tab") {
		const workspaceTarget = requiredStartField(params.workspace, "workspace");
		let workspace;
		try {
			workspace = resolveWorkspace(await getSnapshot(client), workspaceTarget);
		} catch (error) {
			throw new UnstartedAgentLaunchError(error);
		}
		// A failed create response may still have created a location.
		const created = createdLocation(
			await client.request<unknown>("tab.create", {
				workspace_id: workspace.workspace_id,
				cwd,
				label,
				focus: false,
			}),
			"tab.create result",
		);
		return {
			paneId: created.root_pane.pane_id,
			cleanup: { method: "tab.close", id: created.tab.tab_id },
		};
	}
	const created = createdLocation(
		await client.request<unknown>("workspace.create", {
			cwd,
			focus: false,
		}),
		"workspace.create result",
		true,
	);
	try {
		await client.request("tab.rename", { tab_id: created.tab.tab_id, label });
	} catch (error) {
		return rollbackCreatedLocation(
			client,
			{ method: "workspace.close", id: created.workspace.workspace_id },
			error,
		);
	}
	return {
		paneId: created.root_pane.pane_id,
		cleanup: { method: "workspace.close", id: created.workspace.workspace_id },
	};
}

function createdLocation(
	value: unknown,
	path: string,
): { root_pane: PaneInfo; tab: { tab_id: string } };
function createdLocation(
	value: unknown,
	path: string,
	withWorkspace: true,
): {
	root_pane: PaneInfo;
	tab: { tab_id: string };
	workspace: { workspace_id: string };
};
function createdLocation(
	value: unknown,
	path: string,
	withWorkspace = false,
): {
	root_pane: PaneInfo;
	tab: { tab_id: string };
	workspace?: { workspace_id: string };
} {
	if (typeof value !== "object" || value === null) {
		throw new Error(`Herdr ${path} must be an object`);
	}
	const result = value as Record<string, unknown>;
	const tabId = nestedId(result["tab"], "tab_id", `${path}.tab`);
	return {
		root_pane: parsePaneInfo(result["root_pane"], `${path}.root_pane`),
		tab: { tab_id: tabId },
		...(withWorkspace
			? {
					workspace: {
						workspace_id: nestedId(
							result["workspace"],
							"workspace_id",
							`${path}.workspace`,
						),
					},
				}
			: {}),
	};
}

function nestedId(value: unknown, key: string, path: string): string {
	if (typeof value !== "object" || value === null) {
		throw new Error(`Herdr ${path} must be an object`);
	}
	const id = (value as Record<string, unknown>)[key];
	if (typeof id !== "string")
		throw new Error(`Herdr ${path}.${key} must be string`);
	return id;
}

export async function rollbackCreatedLocation(
	client: HerdrConnection,
	cleanup: CreatedLocationCleanup | undefined,
	cause: unknown,
): Promise<never> {
	if (!cleanup) throw cause;
	try {
		await client.request(cleanup.method, {
			[cleanup.method === "tab.close"
				? "tab_id"
				: cleanup.method === "terminal.close"
					? "id"
					: "workspace_id"]: cleanup.id,
		});
	} catch (cleanupError) {
		throw new Error(
			`${cause instanceof Error ? cause.message : String(cause)}; rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
			{ cause },
		);
	}
	throw new RolledBackAgentLaunchError(cause);
}
