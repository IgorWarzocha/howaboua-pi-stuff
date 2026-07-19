import { getSitesAuth } from "./auth.mjs";

const ENDPOINT = "https://chatgpt.com/backend-api/wham/apps";
const CONNECTOR_ID = "connector_20205bf7d4e99a89d7154bb849718324";

export class SitesClient {
	constructor({ fetchImpl = fetch, authProvider = getSitesAuth } = {}) {
		this.fetchImpl = fetchImpl;
		this.authProvider = authProvider;
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
			clientInfo: { name: "pi-sites", version: "0.1.0" },
		});
		this.headers["mcp-protocol-version"] =
			initialized?.protocolVersion ?? "2025-03-26";
		await this.rpc("notifications/initialized", {}, { notification: true });
	}

	async listSitesTools() {
		if (this.tools) return this.tools;
		await this.initialize();
		const response = await this.rpc("tools/list", {});
		const tools = Array.isArray(response?.tools) ? response.tools : [];
		this.tools = tools.filter((tool) => isSitesTool(tool));
		if (this.tools.length === 0) {
			throw new Error("The ChatGPT account did not expose the Sites connector");
		}
		return this.tools;
	}

	async schema(toolSuffix) {
		const tool = await this.findTool(toolSuffix);
		return tool.inputSchema;
	}

	async call(toolSuffix, args) {
		const tool = await this.findTool(toolSuffix);
		const response = await this.rpc("tools/call", {
			name: tool.name,
			arguments: args,
		});
		return decodeToolResult(response);
	}

	async findTool(toolSuffix) {
		const expected = `sites_${toolSuffix}`.toLowerCase();
		const tools = await this.listSitesTools();
		const tool = tools.find((candidate) => {
			const names = [candidate.name, candidate._meta?.resource_name]
				.filter((value) => typeof value === "string")
				.map(normalizeToolName);
			return names.includes(expected);
		});
		if (!tool) throw new Error(`Sites backend no longer exposes ${toolSuffix}`);
		return tool;
	}

	async rpc(method, params, { notification = false } = {}) {
		const payload = { jsonrpc: "2.0", method, params };
		if (!notification) payload.id = ++this.requestId;
		const response = await this.fetchImpl(ENDPOINT, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(45_000),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.headers["mcp-session-id"] = sessionId;
		const body = await readCappedBody(response);
		if (notification && response.ok && !body) return undefined;
		const result = parseRpcBody(body, response.headers.get("content-type"));
		if (!response.ok || result?.error) {
			throw backendError(response.status, result?.error ?? result ?? body);
		}
		return result?.result;
	}
}

function isSitesTool(tool) {
	return tool?._meta?.connector_id === CONNECTOR_ID;
}

function normalizeToolName(name) {
	return name.toLowerCase().replaceAll(".", "_");
}

function parseRpcBody(body, contentType = "") {
	if (contentType?.includes("text/event-stream")) {
		const messages = body
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter((line) => line && line !== "[DONE]");
		if (messages.length === 0)
			throw new Error("Sites backend returned an empty event stream");
		return JSON.parse(messages.at(-1));
	}
	try {
		return JSON.parse(body);
	} catch {
		throw new Error("Sites backend returned a non-JSON response");
	}
}

async function readCappedBody(response, maxBytes = 4 * 1024 * 1024) {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks = [];
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

function decodeToolResult(result) {
	if (result?.isError) throw backendError(200, result);
	if (result?.structuredContent !== undefined) return result.structuredContent;
	const texts = Array.isArray(result?.content)
		? result.content
				.filter((item) => item?.type === "text")
				.map((item) => item.text)
		: [];
	if (texts.length === 1) {
		try {
			return JSON.parse(texts[0]);
		} catch {
			return { message: texts[0] };
		}
	}
	return texts.length > 0 ? { messages: texts } : result;
}

function backendError(status, payload) {
	const serialized = safeStringify(payload);
	const terms = serialized.match(
		/sites_publication_terms_required:\s*(https?:\/\/[^\s"}]+)/i,
	);
	const message = terms
		? "ChatGPT Sites publication terms must be accepted before this operation can continue"
		: `Sites backend request failed${status ? ` (HTTP ${status})` : ""}`;
	return Object.assign(new Error(message), {
		code: terms ? "terms_required" : "backend_error",
		status,
		termsUrl: terms?.[1],
	});
}

function safeStringify(value) {
	try {
		return typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}
