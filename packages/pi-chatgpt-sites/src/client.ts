const ENDPOINT = "https://chatgpt.com/backend-api/wham/apps";
const CONNECTOR_ID = "connector_20205bf7d4e99a89d7154bb849718324";

export interface JsonSchema {
	[key: string]: unknown;
	properties?: Record<string, unknown>;
	required?: string[];
}

export interface SitesClientOptions {
	fetchImpl?: typeof fetch;
	authProvider: () => Promise<{ token: string; accountId: string }>;
	signal?: AbortSignal | undefined;
}

interface SitesTool {
	name: string;
	inputSchema?: JsonSchema;
	_meta: Record<string, unknown>;
}

interface Recovery {
	code?: string;
	saved_version_id?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonSchema(value: unknown): value is JsonSchema {
	return (
		isRecord(value) &&
		(value["properties"] === undefined || isRecord(value["properties"])) &&
		(value["required"] === undefined ||
			(Array.isArray(value["required"]) &&
				value["required"].every((key: unknown) => typeof key === "string")))
	);
}

export class SitesClient {
	private fetchImpl: typeof fetch;
	private authProvider: SitesClientOptions["authProvider"];
	private signal: AbortSignal | undefined;
	private requestId: number;
	private tools: SitesTool[] | undefined;
	private headers: Record<string, string> | undefined;

	constructor({ fetchImpl = fetch, authProvider, signal }: SitesClientOptions) {
		this.fetchImpl = fetchImpl;
		this.authProvider = authProvider;
		this.signal = signal;
		this.requestId = 0;
		this.tools = undefined;
		this.headers = undefined;
	}

	async initialize() {
		if (this.headers) return;
		const { token, accountId } = await this.authProvider();
		this.headers = {
			authorization: `Bearer ${token}`,
			"chatgpt-account-id": accountId,
			"x-openai-product-sku": "codex",
			originator: "pi",
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
		};
		const initialized = await this.rpc("initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "pi-chatgpt-sites", version: "0.1.0" },
		});
		this.headers["mcp-protocol-version"] =
			isRecord(initialized) &&
			typeof initialized["protocolVersion"] === "string"
				? initialized["protocolVersion"]
				: "2025-03-26";
		await this.rpc("notifications/initialized", {}, { notification: true });
	}

	async listSitesTools() {
		if (this.tools) return this.tools;
		await this.initialize();
		const response = await this.rpc("tools/list", {});
		const tools: unknown[] =
			isRecord(response) && Array.isArray(response["tools"])
				? response["tools"]
				: [];
		this.tools = tools.filter((tool) => isSitesTool(tool));
		if (this.tools.length === 0) {
			throw new Error("The ChatGPT account did not expose the Sites connector");
		}
		return this.tools;
	}

	async schema(toolSuffix: string) {
		const tool = await this.findTool(toolSuffix);
		return tool.inputSchema;
	}

	async call(toolSuffix: string, args: unknown) {
		const tool = await this.findTool(toolSuffix);
		const response = await this.rpc("tools/call", {
			name: tool.name,
			arguments: args,
		});
		return decodeToolResult(response);
	}

	async findTool(toolSuffix: string) {
		const expected = `sites_${toolSuffix}`.toLowerCase();
		const tools = await this.listSitesTools();
		const tool = tools.find((candidate) => {
			const names = [candidate.name, candidate._meta["resource_name"]]
				.filter((value) => typeof value === "string")
				.map(normalizeToolName);
			return names.includes(expected);
		});
		if (!tool)
			throw new Error("This Sites operation is unavailable for the account");
		return tool;
	}

	async rpc(
		method: string,
		params: unknown,
		{ notification = false }: { notification?: boolean } = {},
	): Promise<unknown> {
		const payload: {
			jsonrpc: string;
			method: string;
			params: unknown;
			id?: number;
		} = { jsonrpc: "2.0", method, params };
		if (!notification) payload.id = ++this.requestId;
		const response = await this.fetchImpl(ENDPOINT, {
			method: "POST",
			...(this.headers ? { headers: this.headers } : {}),
			body: JSON.stringify(payload),
			signal: this.signal
				? AbortSignal.any([this.signal, AbortSignal.timeout(45_000)])
				: AbortSignal.timeout(45_000),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId && this.headers) this.headers["mcp-session-id"] = sessionId;
		const body = await readCappedBody(response);
		if (response.status === 401 || response.status === 403) {
			const message =
				response.status === 401
					? "Sites rejected the OpenAI Codex login. Ask the user to renew /login openai-codex (legacy OpenAI Codex)."
					: "Sites access was denied (HTTP 403). Ask the user to check Sites access for that account and any network or browser challenge.";
			throw Object.assign(new Error(message), {
				code: "sites_access_denied",
				status: response.status,
			});
		}
		if (notification && response.ok && !body) return undefined;
		const result = parseRpcBody(body, response.headers.get("content-type"));
		const envelope = isRecord(result) ? result : undefined;
		if (!response.ok || envelope?.["error"]) {
			throw backendError(
				response.status,
				envelope?.["error"] ?? result ?? body,
			);
		}
		return envelope?.["result"];
	}
}

function isSitesTool(tool: unknown): tool is SitesTool {
	return (
		isRecord(tool) &&
		typeof tool["name"] === "string" &&
		isRecord(tool["_meta"]) &&
		tool["_meta"]["connector_id"] === CONNECTOR_ID &&
		(tool["inputSchema"] === undefined || isJsonSchema(tool["inputSchema"]))
	);
}

function normalizeToolName(name: string) {
	return name.toLowerCase().replaceAll(".", "_");
}

function parseRpcBody(body: string, contentType: string | null = ""): unknown {
	if (contentType?.includes("text/event-stream")) {
		const messages = body
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter((line) => line && line !== "[DONE]");
		if (messages.length === 0)
			throw new Error("Sites backend returned an empty event stream");
		return JSON.parse(messages.at(-1) ?? "");
	}
	try {
		return JSON.parse(body);
	} catch {
		throw new Error("Sites backend returned a non-JSON response");
	}
}

async function readCappedBody(response: Response, maxBytes = 4 * 1024 * 1024) {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new Error(
					"Sites backend response exceeded the 4 MiB safety limit",
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(
		chunks.map((chunk) => Buffer.from(chunk)),
		total,
	).toString("utf8");
}

function decodeToolResult(result: unknown): unknown {
	const envelope = isRecord(result) ? result : undefined;
	if (envelope?.["isError"]) throw backendError(200, result);
	if (envelope?.["structuredContent"] !== undefined)
		return envelope["structuredContent"];
	const texts: unknown[] = Array.isArray(envelope?.["content"])
		? envelope["content"]
				.filter((item: unknown) => isRecord(item) && item["type"] === "text")
				.map((item: Record<string, unknown>) => item["text"])
		: [];
	if (texts.length === 1) {
		try {
			return JSON.parse(String(texts[0]));
		} catch {
			return { message: texts[0] };
		}
	}
	return texts.length > 0 ? { messages: texts } : result;
}

function backendError(status: number, payload: unknown) {
	const serialized = safeStringify(payload);
	const terms = serialized.match(
		/sites_publication_terms_required:\s*(https?:\/\/[^\s"}]+)/i,
	);
	const recovery = errorRecovery(payload);
	const message = terms
		? "ChatGPT Sites publication terms must be accepted before this operation can continue"
		: recovery.saved_version_id
			? "Sites saved a version but deployment failed; reuse saved_version_id with deployment.deploy after resolving the cause"
			: recovery.code === "site_not_owner_only"
				? "Site is not verified owner-private; reread access before deployment"
				: `Sites backend request failed${status ? ` (HTTP ${status})` : ""}`;
	return Object.assign(new Error(message), {
		code: terms ? "terms_required" : recovery.code || "backend_error",
		status,
		termsUrl: terms?.[1],
		details: recovery.saved_version_id
			? { saved_version_id: recovery.saved_version_id }
			: undefined,
		topic: recovery.saved_version_id
			? "deployment"
			: recovery.code
				? "access"
				: undefined,
	});
}

// Keep partial-save recovery from JSON error envelopes, never arbitrary server prose.
function errorRecovery(payload: unknown, depth = 0): Recovery {
	if (depth > 8 || payload == null) return {};
	if (typeof payload === "string") {
		try {
			return errorRecovery(JSON.parse(payload), depth + 1);
		} catch {
			return {};
		}
	}
	if (typeof payload !== "object") return {};
	const found: Recovery = {};
	const code: unknown = "code" in payload ? payload.code : undefined;
	const savedVersionId: unknown =
		"saved_version_id" in payload ? payload.saved_version_id : undefined;
	if (code === "site_not_owner_only") found.code = code;
	if (typeof savedVersionId === "string" && savedVersionId) {
		found.saved_version_id = savedVersionId;
	}
	for (const value of Object.values(payload)) {
		const nested = errorRecovery(value, depth + 1);
		if (!found.code && nested.code) found.code = nested.code;
		if (!found.saved_version_id && nested.saved_version_id)
			found.saved_version_id = nested.saved_version_id;
	}
	return found;
}

function safeStringify(value: unknown): string {
	try {
		return typeof value === "string"
			? value
			: (JSON.stringify(value) ?? String(value));
	} catch {
		return String(value);
	}
}
