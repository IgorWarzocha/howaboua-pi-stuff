export const OPERATIONS = Object.freeze({
  site: Object.freeze({
    list: operation("list_sites", "site"),
    get: operation("get_site", "site"),
    create: operation("create_site", "site", { local: "create" }),
    update: operation("update_site_metadata", "site"),
  }),
  version: Object.freeze({
    list: operation("list_site_versions", "version"),
    get: operation("get_site_version", "version"),
    save: operation("save_site_version", "version", { local: "save" }),
  }),
  deployment: Object.freeze({
    deploy: operation("deploy_site_version", "deployment", { local: "deploy" }),
    status: operation("get_deployment_status", "deployment"),
  }),
  access: Object.freeze({
    get: operation("get_site", "access", { select: "access" }),
    update: operation("update_site_access", "access"),
  }),
  environment: Object.freeze({
    get: operation("get_environment_variables", "environment"),
    update: operation("update_environment_variables", "environment"),
  }),
  domain: Object.freeze({
    list: operation("list_custom_domains", "domains"),
    add: operation("add_custom_domain", "domains"),
    refresh: operation("refresh_custom_domain_status", "domains"),
    remove: operation("remove_custom_domain", "domains"),
  }),
  analytics: Object.freeze({
    overview: operation("get_site_analytics_overview", "analytics"),
    events: operation("list_site_analytics_events", "analytics"),
    query: operation("query_site_analytics_event", "analytics"),
  }),
});

function operation(tool, topic, options = {}) {
  return Object.freeze({ tool, topic, ...options });
}

export function resolveOperation(resource, action) {
  if (typeof resource !== "string" || typeof action !== "string") {
    throw facadeError("invalid_operation", "resource and action must both be strings", "index");
  }
  const resourceOperations = OPERATIONS[resource];
  const resolved = resourceOperations?.[action];
  if (!resolved) {
    const topic = resource === "domain" ? "domains" : resource in OPERATIONS ? resource : "index";
    throw facadeError(
      "unknown_operation",
      `Unknown Sites operation ${resource}.${action}; read sites_documentation(\"${topic}\")`,
      topic,
    );
  }
  return { resource, action, key: `${resource}.${action}`, ...resolved };
}

export function facadeError(code, message, topic, details) {
  return Object.assign(new Error(message), { code, topic, details });
}

export function operationForTopic(topic) {
  if (typeof topic !== "string" || !topic.includes(".")) return undefined;
  const [resource, action, ...rest] = topic.split(".");
  if (rest.length > 0) return undefined;
  try {
    return resolveOperation(resource, action);
  } catch {
    return undefined;
  }
}
