import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type JsonSchema,
	type SitesClient,
	SitesOperationUnavailable,
} from "./client.js";
import {
	acquireHostingLock,
	inspectCleanCommit,
	persistProjectId,
	projectContext,
	readHosting,
	resolveProjectId,
} from "./local-project.js";
import type { ResolvedOperation } from "./operations.js";
import {
	facadeError,
	operationForTopic,
	resolveOperation,
} from "./operations.js";
import { redact } from "./redact.js";
import {
	newCheckoutPath,
	openSource,
	pushCommit,
	requireGitWorktreeEnvironment,
} from "./source-git.js";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "docs");
const sourceCredentialTool = "create_source_repository_write_credential";
const openSchema = {
	type: "object",
	properties: {
		project_id: { type: "string" },
		project_dir: { type: "string" },
	},
	required: ["project_id", "project_dir"],
	additionalProperties: false,
};
export async function call(
	request: unknown,
	client: Pick<SitesClient, "schema" | "call">,
	cwd: string,
	signal?: AbortSignal,
) {
	if (!isRecord(request)) {
		throw facadeError(
			"invalid_request",
			"sites expects one JSON object",
			"index",
		);
	}
	const operation = resolveOperation(request["resource"], request["action"]);
	const params = request["params"] === undefined ? {} : request["params"];
	if (!isRecord(params)) {
		throw facadeError(
			"invalid_params",
			"params must be an object",
			operation.topic,
		);
	}
	rejectKeys(
		params,
		["publish_on_push"],
		"publish_on_push is not supported; use explicit save/deploy",
	);

	if (operation.local === "open") {
		validateAgainstSchema(params, openSchema);
		requireGitWorktreeEnvironment();
		const projectId = params["project_id"];
		if (typeof projectId !== "string" || !projectId.trim()) {
			throw new Error("site.open requires the selected Site's project_id");
		}
		const destination = await newCheckoutPath(params["project_dir"], cwd);
		const credential = await siteSourceCredential(client, projectId);
		return openSource(destination, projectId, credential, signal);
	}

	const prepared = await prepare(operation, { ...params }, client, cwd, signal);
	try {
		const raw = await client.call(prepared.tool, prepared.args);
		const completed = await prepared.after(raw);
		return redact(selectResult(operation, completed));
	} finally {
		await prepared.cleanup();
	}
}

async function prepare(
	operation: ResolvedOperation,
	params: Record<string, unknown>,
	client: Pick<SitesClient, "schema" | "call">,
	cwd: string,
	signal?: AbortSignal,
) {
	const tool = selectBackendTool(operation, params);
	const schema = await client.schema(tool);
	const project = await projectContext(params["project_dir"], cwd);
	delete params["project_dir"];
	let after = async (value: unknown) => value;
	let cleanup = async () => {};

	if (tool === "list_sites" && params["limit"] === undefined)
		params["limit"] = 20;
	if (tool === "list_site_versions" && params["limit"] === undefined)
		params["limit"] = 20;

	if (operation.local === "create") {
		validateAgainstSchema(params, schema);
		cleanup = await acquireHostingLock(project);
		try {
			const manifest = await readHosting(project);
			if (manifest["project_id"]) {
				throw facadeError(
					"site_already_linked",
					".openai/hosting.json already has project_id; reuse that site",
					"site",
				);
			}
		} catch (error) {
			await cleanup();
			throw error;
		}
		after = async (value: unknown) => {
			const projectId = recordResult(value)?.["id"];
			if (typeof projectId !== "string" || !projectId) {
				throw new Error("Sites created a site but returned no project ID");
			}
			try {
				await persistProjectId(project, projectId);
			} catch (error) {
				throw facadeError(
					"manifest_persist_failed",
					`Site was created as ${projectId}, but ${project.manifestPath} could not be updated: ${error instanceof Error ? error.message : String(error)}`,
					"site",
					{ project_id: projectId, manifest_path: project.manifestPath },
				);
			}
			return value;
		};
	} else if (operation.local === "save") {
		rejectKeys(
			params,
			["commit_sha", "archive"],
			"Source save derives commit_sha and does not accept archives",
		);
		const manifest = await readHosting(project);
		if (typeof manifest["project_id"] !== "string" || !manifest["project_id"]) {
			throw facadeError(
				"unbound_repository",
				"Source save requires project_id in the repository's .openai/hosting.json",
				"version",
			);
		}
		const projectId = await resolveProjectId(params, project);
		params["project_id"] = projectId;
		const { root, commitSha } = await inspectCleanCommit(
			project,
			projectId,
			signal,
		);
		params["commit_sha"] = commitSha;
		// Reject invalid inputs before a source push. Both save routes share this owner.
		validateAgainstSchema(params, schema);
		const credential = await siteSourceCredential(client, projectId);
		if (recordResult(credential)?.["publish_on_push_accepted"] === true) {
			throw facadeError(
				"automatic_publication_unsupported",
				"Sites returned an auto-publishing credential; source was not pushed",
				"version",
			);
		}
		await pushCommit(root, commitSha, credential, signal);
	} else {
		if (schema?.properties?.["project_id"] && !params["project_id"]) {
			params["project_id"] = await resolveProjectId(params, project);
		}
		validateAgainstSchema(params, schema);
	}

	return { tool, args: params, after, cleanup };
}

function selectBackendTool(
	operation: ResolvedOperation,
	params: Record<string, unknown>,
) {
	if (operation.local !== "deploy") return operation.tool;
	const visibility = params["visibility"];
	if (visibility !== "private" && visibility !== "shared") {
		throw facadeError(
			"visibility_required",
			'deployment.deploy requires params.visibility as "private" or "shared"',
			"deployment",
		);
	}
	delete params["visibility"];
	return visibility === "private"
		? "deploy_private_site_version"
		: operation.tool;
}

async function siteSourceCredential(
	client: Pick<SitesClient, "call">,
	projectId: string,
) {
	return unwrapResult(
		await client.call(sourceCredentialTool, { project_id: projectId }),
	);
}

function rejectKeys(
	params: Record<string, unknown>,
	keys: string[],
	message: string,
) {
	if (keys.some((key) => key in params)) throw new Error(message);
}

function validateAgainstSchema(
	params: Record<string, unknown>,
	schema: JsonSchema | undefined,
) {
	const properties = schema?.properties ?? {};
	const unknown = Object.keys(params).filter(
		(key) => !Object.hasOwn(properties, key),
	);
	if (unknown.length > 0) {
		throw new Error(
			`Unknown parameter${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
		);
	}
	const missing = (schema?.required ?? []).filter(
		(key) => params[key] === undefined,
	);
	if (missing.length > 0) {
		throw new Error(
			`Missing required parameter${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
		);
	}
}

function selectResult(operation: ResolvedOperation, value: unknown) {
	if (operation.select !== "access") return value;
	const site = recordResult(value);
	return {
		result: {
			id: site?.["id"],
			title: site?.["title"],
			current_live_url: site?.["current_live_url"],
			access_mode: site?.["access_mode"],
			access_policy: site?.["access_policy"],
			available_access_modes: site?.["available_access_modes"],
		},
	};
}

function unwrapResult(value: unknown): unknown {
	return isRecord(value) ? (value["result"] ?? value) : value;
}
function recordResult(value: unknown): Record<string, unknown> | undefined {
	const result = unwrapResult(value);
	return isRecord(result) ? result : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function documentation(
	input = "index",
	client: Pick<SitesClient, "schema">,
) {
	const requested = input.trim() || "index";
	const topic = requested.replace(/^['"]|['"]$/g, "");
	const operation = operationForTopic(topic);
	if (operation) {
		const guide = await readTopic(operation.topic);
		const schemas =
			operation.local === "open"
				? openSchema
				: operation.local === "deploy"
					? {
							private: await liveDocumentationSchema(
								client,
								"deploy_private_site_version",
								operation,
							),
							shared: await liveDocumentationSchema(
								client,
								operation.tool,
								operation,
							),
						}
					: await liveDocumentationSchema(client, operation.tool, operation);
		return boundedDocumentation(
			`${guide}\n\n## Current params schema for ${operation.key}\n\n` +
				`${operationSchemaNote(operation)}\n\n\`\`\`json\n${JSON.stringify(schemas, null, 2)}\n\`\`\`\n`,
		);
	}
	const known = new Set([
		"index",
		"workflow",
		"site",
		"version",
		"deployment",
		"access",
		"environment",
		"domains",
		"analytics",
		"mcp",
		"building",
		"identity",
		"diagnostics",
		"database",
		"schedules",
	]);
	return readTopic(known.has(topic) ? topic : "index");
}

function operationSchemaNote(operation: ResolvedOperation) {
	if (operation.local === "open") {
		return "Pass the selected Site's exact ID and a new local directory in `params`.";
	}
	if (operation.local === "save") {
		return "The facade derives and pushes `commit_sha`; archives are unsupported. `project_dir` selects the clean bound repository.";
	}
	if (operation.local === "deploy") {
		return 'Set `visibility: "private" | "shared"` to select the matching schema. A null schema means that route is unavailable.';
	}
	return "Pass the backend fields inside `params`. `project_id` may be omitted when `.openai/hosting.json` supplies it.";
}

async function liveDocumentationSchema(
	client: Pick<SitesClient, "schema">,
	tool: string,
	operation: ResolvedOperation,
) {
	let schema: JsonSchema | undefined;
	try {
		schema = await client.schema(tool);
	} catch (error) {
		if (error instanceof SitesOperationUnavailable) return null;
		throw error;
	}
	if (!schema) return null;
	const projected: JsonSchema = JSON.parse(
		JSON.stringify(schema, (key, value) =>
			(key === "description" || key === "title") && typeof value === "string"
				? undefined
				: value,
		),
	);
	const blocked = [
		"publish_on_push",
		...(operation.local === "save" ? ["commit_sha", "archive"] : []),
	];
	for (const key of blocked) delete projected.properties?.[key];
	if (projected.required)
		projected.required = projected.required.filter(
			(key) => !blocked.includes(key),
		);
	return projected;
}

async function readTopic(topic: string) {
	const text = await readFile(join(docsDir, `${topic}.md`), "utf8");
	return boundedDocumentation(text);
}

function boundedDocumentation(text: string) {
	const max = 16_000;
	if (Buffer.byteLength(text) <= max) return text;
	const suffix = "\n\n[Documentation truncated; request the narrower topic.]\n";
	const budget = max - Buffer.byteLength(suffix);
	let prefix = Buffer.from(text).subarray(0, budget).toString("utf8");
	while (Buffer.byteLength(prefix) > budget) prefix = prefix.slice(0, -1);
	return `${prefix}${suffix}`;
}
