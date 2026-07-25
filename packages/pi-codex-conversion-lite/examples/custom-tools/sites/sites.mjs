#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SitesClient } from "./client.mjs";
import {
  acquireHostingLock,
  inspectCleanCommit,
  persistProjectId,
  projectContext,
  pushCommit,
  readHosting,
  resolveProjectId,
} from "./local-project.mjs";
import { facadeError, operationForTopic, resolveOperation } from "./operations.mjs";
import { boundedJson, redact } from "./redact.mjs";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "docs");
const mode = process.argv[2];

try {
  const input = await readStdin();
  const result = mode === "documentation" ? await documentation(input) : await call(input);
  process.stdout.write(typeof result === "string" ? result : boundedJson(result));
} catch (error) {
  process.stdout.write(
    boundedJson({
      ok: false,
      error: {
        code: error.code || "sites_error",
        message: error.message || "Sites operation failed",
        topic: error.topic,
        terms_url: error.termsUrl,
        status: error.status,
        details: error.details,
      },
    }),
  );
}

async function call(input) {
  let request;
  try {
    request = JSON.parse(input);
  } catch {
    throw facadeError("invalid_json", "sites expects one JSON object", "index");
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw facadeError("invalid_request", "sites expects one JSON object", "index");
  }
  const operation = resolveOperation(request.resource, request.action);
  const params = request.params === undefined ? {} : request.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw facadeError("invalid_params", "params must be an object", operation.topic);
  }

  const client = new SitesClient();
  const prepared = await prepare(operation, { ...params }, client);
  try {
    validateAgainstSchema(prepared.args, await client.schema(prepared.tool), prepared.allowedExtra);
    const raw = await client.call(prepared.tool, prepared.args);
    const completed = await prepared.after(raw);
    return {
      ok: true,
      operation: operation.key,
      result: redact(selectResult(operation, completed)),
    };
  } finally {
    await prepared.cleanup();
  }
}

async function prepare(operation, params, client) {
  const project = await projectContext(params.project_dir);
  delete params.project_dir;
  let tool = operation.tool;
  let after = async (value) => value;
  let cleanup = async () => {};
  const allowedExtra = [];

  if (operation.local === "create") {
    cleanup = await acquireHostingLock(project);
    try {
      const manifest = await readHosting(project);
      if (manifest.project_id) {
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
    after = async (value) => {
      const projectId = unwrapResult(value)?.id;
      if (typeof projectId !== "string" || !projectId) {
        throw new Error("Sites created a site but returned no project ID");
      }
      try {
        await persistProjectId(project, projectId);
      } catch (error) {
        throw facadeError(
          "manifest_persist_failed",
          `Site was created as ${projectId}, but ${project.manifestPath} could not be updated: ${error.message}`,
          "site",
          { project_id: projectId, manifest_path: project.manifestPath },
        );
      }
      return value;
    };
  } else if (operation.local === "save") {
    rejectKeys(params, ["commit_sha", "archive"], "version.save derives commit_sha and does not accept archives");
    const manifest = await readHosting(project);
    if (typeof manifest.project_id !== "string" || !manifest.project_id) {
      throw facadeError(
        "unbound_repository",
        "version.save requires project_id in the repository's .openai/hosting.json",
        "version",
      );
    }
    params.project_id = await resolveProjectId(params, project);
    const { root, commitSha } = await inspectCleanCommit(project);
    const credentialResponse = await client.call("create_source_repository_write_credential", {
      project_id: params.project_id,
    });
    await pushCommit({ root, commitSha, credential: unwrapResult(credentialResponse) });
    params.commit_sha = commitSha;
  } else {
    const schema = await client.schema(tool);
    if (schema?.properties?.project_id && !params.project_id) {
      params.project_id = await resolveProjectId(params, project);
    }
  }

  if (operation.local === "deploy") {
    const visibility = params.visibility;
    if (visibility !== "private" && visibility !== "shared") {
      throw facadeError(
        "visibility_required",
        'deployment.deploy requires params.visibility as "private" or "shared"',
        "deployment",
      );
    }
    tool = visibility === "private" ? "deploy_private_site_version" : "deploy_site_version";
    delete params.visibility;
  }

  if (operation.tool === "list_sites" && params.limit === undefined) params.limit = 20;
  if (operation.tool === "list_site_versions" && params.limit === undefined) params.limit = 20;
  return { tool, args: params, after, cleanup, allowedExtra };
}

function rejectKeys(params, keys, message) {
  if (keys.some((key) => key in params)) throw new Error(message);
}

function validateAgainstSchema(params, schema, allowedExtra = []) {
  const properties = schema?.properties ?? {};
  const unknown = Object.keys(params).filter(
    (key) => !(key in properties) && !allowedExtra.includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown parameter${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  const missing = (schema?.required ?? []).filter((key) => params[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required parameter${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }
}

function selectResult(operation, value) {
  if (operation.select !== "access") return value;
  const site = unwrapResult(value);
  return {
    result: {
      id: site?.id,
      title: site?.title,
      current_live_url: site?.current_live_url,
      access_mode: site?.access_mode,
      access_policy: site?.access_policy,
      available_access_modes: site?.available_access_modes,
    },
  };
}

function unwrapResult(value) {
  return value?.result ?? value;
}

async function documentation(input) {
  const requested = input.trim() || "index";
  const topic = requested.replace(/^['"]|['"]$/g, "");
  const operation = operationForTopic(topic);
  if (operation) {
    const guide = await readTopic(operation.topic);
    const client = new SitesClient();
    const schemas = operation.local === "deploy"
      ? {
          private: await client.schema("deploy_private_site_version"),
          shared: await client.schema("deploy_site_version"),
        }
      : await client.schema(operation.tool);
    return boundedDocumentation(
      `${guide}\n\n## Current backend schema for ${operation.key}\n\n` +
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
  ]);
  return readTopic(known.has(topic) ? topic : "index");
}

function operationSchemaNote(operation) {
  if (operation.local === "save") {
    return "The facade requires a committed Site binding, derives `commit_sha`, obtains Git credentials, pushes internally, and rejects caller-supplied `commit_sha` or `archive`.";
  }
  if (operation.local === "deploy") {
    return 'The facade additionally requires `visibility: "private" | "shared"`; this facade field is stripped before the backend call.';
  }
  return "Pass the backend fields inside `params`. `project_id` may be omitted when `.openai/hosting.json` supplies it.";
}

async function readTopic(topic) {
  const text = await readFile(join(docsDir, `${topic}.md`), "utf8");
  return boundedDocumentation(text);
}

function boundedDocumentation(text) {
  const max = 16_000;
  if (Buffer.byteLength(text) <= max) return text;
  const suffix = "\n\n[Documentation truncated; request the narrower topic.]\n";
  const budget = max - Buffer.byteLength(suffix);
  let prefix = Buffer.from(text).subarray(0, budget).toString("utf8");
  while (Buffer.byteLength(prefix) > budget) prefix = prefix.slice(0, -1);
  return `${prefix}${suffix}`;
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}
