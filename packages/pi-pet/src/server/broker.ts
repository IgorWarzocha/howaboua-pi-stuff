import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, constants as fsConstants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import type { PiPetConfig } from "../config.ts";
import {
  type AgentActivity,
  type BrokerSnapshot,
  type BrokerStatus,
  ContractError,
  jsonText,
  LIMITS,
  type PetCatalog,
  type PromptRequest,
  parsePetCommand,
  parsePromptAck,
  parsePromptSubmission,
} from "../protocol/index.ts";

interface BrokerOptions {
  config: PiPetConfig;
  webRoot: string;
  petDirectory: string;
  catalog: PetCatalog;
  reloadPet?: () => Promise<{ directory: string; catalog: PetCatalog }>;
}

interface EventClient {
  response: ServerResponse;
  id: string;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

interface PendingPrompt {
  prompt: PromptRequest;
  sessionId: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const WEB_PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
});

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function bearer(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

function securityHeaders(): Record<string, string> {
  return {
    "content-security-policy":
      "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...JSON_HEADERS, ...securityHeaders() });
  response.end(jsonText(body));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { ok: false, error: message });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = request.headers["content-length"];
  if (contentLength && Number(contentLength) > LIMITS.requestBodyBytes)
    throw new ContractError("Request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > LIMITS.requestBodyBytes) throw new ContractError("Request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) throw new ContractError("Request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ContractError("Request body must be valid JSON.");
  }
}

function sse(response: ServerResponse, event: string, data: unknown, id: string = randomUUID()): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function activeSession(request: IncomingMessage): string | undefined {
  const value = request.headers["x-pi-pet-session"];
  return typeof value === "string" && SESSION_ID_PATTERN.test(value) ? value : undefined;
}

function decodeAssetPath(rawPath: string): string | undefined {
  let relative: string;
  try {
    relative = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  if (!relative || relative.includes("\0") || relative.includes("\\") || normalize(relative).startsWith(".."))
    return undefined;
  return relative.startsWith("/") ? undefined : relative;
}

export class PiPetBroker {
  readonly #config: PiPetConfig;
  readonly #webRoot: string;
  #petDirectory: string;
  #catalog: PetCatalog;
  readonly #reloadPet: BrokerOptions["reloadPet"];
  readonly #displayClients = new Map<string, EventClient>();
  readonly #pendingPrompts = new Map<string, PendingPrompt>();
  readonly #promptRates = new Map<string, RateWindow>();
  #agentClient: EventClient | undefined;
  #revision = 0;
  #activity: AgentActivity = "idle";
  #stableAction: string;
  #action: string;
  #note: string | undefined;
  #bubble: BrokerSnapshot["bubble"];
  #updatedAt = new Date().toISOString();
  #actionTimer: NodeJS.Timeout | undefined;
  #bubbleTimer: NodeJS.Timeout | undefined;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #server = createServer((request, response) => void this.#route(request, response));

  constructor(options: BrokerOptions) {
    this.#config = options.config;
    this.#webRoot = options.webRoot;
    this.#petDirectory = options.petDirectory;
    this.#catalog = options.catalog;
    this.#reloadPet = options.reloadPet;
    this.#stableAction = options.catalog.defaultAction;
    this.#action = options.catalog.defaultAction;
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once("error", onError);
      this.#server.listen(this.#config.port, this.#config.host, () => {
        this.#server.off("error", onError);
        resolve();
      });
    });
    this.#heartbeatTimer = setInterval(() => {
      for (const client of this.#displayClients.values()) client.response.write(": keepalive\n\n");
      this.#agentClient?.response.write(": keepalive\n\n");
      this.#pruneRates();
      this.#expirePrompts();
    }, 15_000);
    this.#heartbeatTimer.unref();
  }

  async close(): Promise<void> {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#actionTimer) clearTimeout(this.#actionTimer);
    if (this.#bubbleTimer) clearTimeout(this.#bubbleTimer);
    for (const client of this.#displayClients.values()) client.response.end();
    this.#agentClient?.response.end();
    await new Promise<void>((resolve, reject) => this.#server.close((error) => (error ? reject(error) : resolve())));
  }

  get address(): string {
    return `http://${this.#config.host}:${this.#config.port}`;
  }

  #snapshot(): BrokerSnapshot {
    const snapshot: BrokerSnapshot = {
      protocol: "pi-pet/1",
      revision: this.#revision,
      activity: this.#activity,
      action: this.#action,
      updatedAt: this.#updatedAt,
      agent: { connected: Boolean(this.#agentClient) },
      displays: this.#displayClients.size,
    };
    if (this.#note !== undefined) snapshot.note = this.#note;
    if (this.#bubble !== undefined) snapshot.bubble = this.#bubble;
    if (this.#agentClient) snapshot.agent.sessionId = this.#agentClient.id;
    return snapshot;
  }

  #status(): BrokerStatus {
    return {
      ok: true,
      pet: {
        id: this.#catalog.id,
        displayName: this.#catalog.displayName,
        actions: Object.keys(this.#catalog.actions).length,
      },
      snapshot: this.#snapshot(),
    };
  }

  #broadcast(event: string, data: unknown): void {
    for (const client of this.#displayClients.values()) sse(client.response, event, data);
  }

  async #reload(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authorized(request, "agent")) return sendError(response, 401, "Unauthorized.");
    if (!this.#currentAgent(request)) return sendError(response, 409, "This Pi session does not own pet reloads.");
    if (!this.#reloadPet) return sendError(response, 501, "Pet reload is unavailable.");
    const loaded = await this.#reloadPet();
    this.#petDirectory = loaded.directory;
    this.#catalog = loaded.catalog;
    if (!this.#catalog.actions[this.#stableAction]) this.#stableAction = this.#catalog.defaultAction;
    if (!this.#catalog.actions[this.#action]) this.#action = this.#stableAction;
    this.#broadcast("catalog", this.#catalog);
    this.#commit();
    sendJson(response, 200, { ok: true, catalog: this.#catalog, snapshot: this.#snapshot() });
  }

  #commit(): void {
    this.#revision += 1;
    this.#updatedAt = new Date().toISOString();
    this.#broadcast("snapshot", this.#snapshot());
  }

  #resolveAction(name: string): string | undefined {
    if (this.#catalog.actions[name]) return name;
    const target = this.#catalog.aliases[name];
    return target && this.#catalog.actions[target] ? target : undefined;
  }

  #setState(action: string, note?: string): void {
    if (this.#actionTimer) clearTimeout(this.#actionTimer);
    this.#stableAction = action;
    this.#action = action;
    this.#note = note;
    this.#commit();
  }

  #setActivity(activity: AgentActivity, action: string, note?: string): void {
    this.#activity = activity;
    if (activity === "settled") {
      this.#stableAction = this.#catalog.defaultAction;
      this.#playAction(action, note);
    } else {
      this.#setState(action, note);
    }
  }

  #playAction(actionName: string, note?: string): void {
    if (this.#actionTimer) clearTimeout(this.#actionTimer);
    const action = this.#catalog.actions[actionName];
    if (!action) throw new ContractError(`Unknown pet action: ${actionName}.`);
    this.#action = actionName;
    this.#note = note;
    this.#commit();
    const duration = action.frames.reduce((total, frame) => total + frame.durationMs, 0);
    this.#actionTimer = setTimeout(
      () => {
        const next = action.next && this.#catalog.actions[action.next] ? action.next : this.#stableAction;
        this.#action = next;
        this.#note = undefined;
        this.#commit();
      },
      Math.max(100, duration),
    );
    this.#actionTimer.unref();
  }

  #say(text: string): void {
    if (this.#bubbleTimer) clearTimeout(this.#bubbleTimer);
    const duration = Math.min(12_000, Math.max(3_500, text.length * 55));
    this.#bubble = { text, expiresAt: new Date(Date.now() + duration).toISOString() };
    this.#commit();
    this.#bubbleTimer = setTimeout(() => {
      this.#bubble = undefined;
      this.#commit();
    }, duration);
    this.#bubbleTimer.unref();
  }

  #originAllowed(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    const host = request.headers.host;
    if (!host) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && parsed.host === host && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }

  #authorized(request: IncomingMessage, role: "agent" | "display"): boolean {
    const expected = role === "agent" ? this.#config.agentToken : this.#config.displayToken;
    return tokenMatches(bearer(request), expected);
  }

  #currentAgent(request: IncomingMessage): string | undefined {
    if (!this.#authorized(request, "agent")) return undefined;
    const session = activeSession(request);
    return session && session === this.#agentClient?.id ? session : undefined;
  }

  #connectAgent(response: ServerResponse, id: string): void {
    for (const [promptId, pending] of this.#pendingPrompts) {
      if (pending.sessionId === id) continue;
      this.#pendingPrompts.delete(promptId);
      this.#broadcast("prompt-ack", {
        id: promptId,
        accepted: false,
        detail: "A different Pi session took ownership.",
      });
    }
    this.#agentClient = { response, id };
    this.#commit();
    for (const pending of this.#pendingPrompts.values()) {
      if (pending.sessionId === id) sse(response, "prompt-request", pending.prompt, pending.prompt.id);
    }
  }

  #connectDisplay(response: ServerResponse, id: string): void {
    this.#displayClients.set(id, { response, id });
    sse(response, "catalog", this.#catalog);
    sse(response, "snapshot", this.#snapshot());
    this.#commit();
  }

  #disconnectClient(role: "agent" | "display", id: string): void {
    if (role === "display") {
      if (this.#displayClients.delete(id)) this.#commit();
      return;
    }
    if (this.#agentClient?.id !== id) return;
    this.#agentClient = undefined;
    if (this.#actionTimer) clearTimeout(this.#actionTimer);
    if (this.#bubbleTimer) clearTimeout(this.#bubbleTimer);
    this.#stableAction = this.#catalog.defaultAction;
    this.#action = this.#catalog.defaultAction;
    this.#activity = "idle";
    this.#note = undefined;
    this.#bubble = undefined;
    this.#commit();
  }

  #openEvents(request: IncomingMessage, response: ServerResponse, role: "agent" | "display"): void {
    if (!this.#authorized(request, role)) {
      sendError(response, 401, "Unauthorized.");
      return;
    }
    const id = role === "agent" ? activeSession(request) : randomUUID();
    if (!id) {
      sendError(response, 400, "A valid X-Pi-Pet-Session header is required.");
      return;
    }
    if (role === "agent" && this.#agentClient) {
      sendError(response, 409, "Another Pi session already owns prompt routing.");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      ...securityHeaders(),
    });
    response.write(": connected\n\n");
    if (role === "agent") this.#connectAgent(response, id);
    else this.#connectDisplay(response, id);
    response.once("close", () => this.#disconnectClient(role, id));
  }

  #allowPrompt(request: IncomingMessage): boolean {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = this.#promptRates.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.#promptRates.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= 10;
  }

  #pruneRates(): void {
    const before = Date.now() - 120_000;
    for (const [key, value] of this.#promptRates) if (value.startedAt < before) this.#promptRates.delete(key);
  }

  #expirePrompts(): void {
    const before = Date.now() - 30_000;
    for (const [id, pending] of this.#pendingPrompts) {
      if (Date.parse(pending.prompt.createdAt) >= before) continue;
      this.#pendingPrompts.delete(id);
      this.#broadcast("prompt-ack", { id, accepted: false, detail: "Pi did not acknowledge the prompt in time." });
    }
  }

  async #submitPrompt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authorized(request, "display")) return sendError(response, 401, "Unauthorized.");
    if (!this.#allowPrompt(request)) return sendError(response, 429, "Prompt rate limit exceeded. Try again shortly.");
    if (!this.#agentClient) return sendError(response, 503, "No Pi session is connected.");
    if (this.#pendingPrompts.size >= 8)
      return sendError(response, 429, "Too many prompts are awaiting acknowledgement.");
    const input = parsePromptSubmission(await readJsonBody(request));
    const prompt: PromptRequest = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    this.#pendingPrompts.set(prompt.id, { prompt, sessionId: this.#agentClient.id });
    sse(this.#agentClient.response, "prompt-request", prompt, prompt.id);
    this.#broadcast("prompt-pending", { id: prompt.id, device: prompt.device, createdAt: prompt.createdAt });
    sendJson(response, 202, { ok: true, id: prompt.id });
  }

  async #ackPrompt(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authorized(request, "agent")) return sendError(response, 401, "Unauthorized.");
    if (!this.#currentAgent(request)) return sendError(response, 409, "This Pi session does not own prompt routing.");
    const ack = parsePromptAck(await readJsonBody(request));
    if (!this.#pendingPrompts.delete(ack.id)) return sendError(response, 404, "Prompt request is no longer pending.");
    this.#broadcast("prompt-ack", ack);
    sendJson(response, 200, { ok: true, id: ack.id });
  }

  async #command(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authorized(request, "agent")) return sendError(response, 401, "Unauthorized.");
    if (!this.#currentAgent(request)) return sendError(response, 409, "This Pi session does not own pet control.");
    const command = parsePetCommand(await readJsonBody(request));
    const requestedAction =
      command.kind === "activity" && command.value === "idle" ? this.#catalog.defaultAction : command.value;
    const resolvedAction = command.kind === "say" ? undefined : this.#resolveAction(requestedAction);
    if (command.kind !== "say" && !resolvedAction) {
      return sendError(
        response,
        422,
        `Unknown pet action: ${command.value}. Query /api/v1/catalog or add it to pet.pi.json.`,
      );
    }
    if (command.kind === "say") this.#say(command.value);
    else if (command.kind === "activity") this.#setActivity(command.value, resolvedAction as string, command.note);
    else if (command.kind === "action") this.#playAction(resolvedAction as string, command.note);
    else this.#setState(resolvedAction as string, command.note);
    sendJson(response, 200, {
      ok: true,
      snapshot: this.#snapshot(),
      ...(resolvedAction ? { requestedAction, resolvedAction } : {}),
    });
  }

  async #serveAsset(response: ServerResponse, rawPath: string): Promise<void> {
    const relative = decodeAssetPath(rawPath);
    if (!relative) return sendError(response, 400, "Invalid asset path.");
    const root = await realpath(this.#petDirectory);
    let path: string;
    try {
      path = await realpath(join(root, relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return sendError(response, 404, "Asset not found.");
      throw error;
    }
    if (path !== root && !path.startsWith(`${root}${sep}`))
      return sendError(response, 400, "Asset escapes pet directory.");
    const expected = await stat(path);
    const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    let streamOwnsHandle = false;
    try {
      const info = await handle.stat();
      if (info.dev !== expected.dev || info.ino !== expected.ino)
        return sendError(response, 409, "Asset changed during validation; retry.");
      if (!info.isFile() || info.size > LIMITS.assetBytes)
        return sendError(response, 413, "Asset is not a bounded regular file.");
      const contentType = MIME_TYPES[extname(path).toLowerCase()];
      if (!contentType?.startsWith("image/")) return sendError(response, 415, "Unsupported asset type.");
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": info.size,
        "cache-control": "private, max-age=300",
        ...securityHeaders(),
      });
      const stream = handle.createReadStream({ autoClose: true });
      streamOwnsHandle = true;
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } finally {
      if (!streamOwnsHandle) await handle.close();
    }
  }

  async #serveWeb(response: ServerResponse, pathname: string): Promise<void> {
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!WEB_PATH_PATTERN.test(relative) || relative.includes("..")) return sendError(response, 404, "Not found.");
    let path = join(this.#webRoot, relative);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      path = join(this.#webRoot, "index.html");
      info = await stat(path);
    }
    if (!info.isFile()) return sendError(response, 404, "Not found.");
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-cache",
      ...securityHeaders(),
    });
    createReadStream(path).pipe(response);
  }

  #authorizedViewer(request: IncomingMessage): boolean {
    return this.#authorized(request, "display") || this.#authorized(request, "agent");
  }

  async #routeGet(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (pathname === "/health") return sendJson(response, 200, { ok: true, protocol: "pi-pet/1" });
    if (pathname === "/api/v1/events") return this.#openEvents(request, response, "display");
    if (pathname === "/api/v1/agent/events") return this.#openEvents(request, response, "agent");
    if (pathname.startsWith("/api/")) {
      if (!this.#authorizedViewer(request)) return sendError(response, 401, "Unauthorized.");
      if (pathname === "/api/v1/status") return sendJson(response, 200, this.#status());
      if (pathname === "/api/v1/catalog")
        return sendJson(response, 200, { ok: true, catalog: this.#catalog, snapshot: this.#snapshot() });
      if (pathname.startsWith("/api/v1/assets/"))
        return await this.#serveAsset(response, pathname.slice("/api/v1/assets/".length));
      return sendError(response, 404, "Not found.");
    }
    await this.#serveWeb(response, pathname);
  }

  async #routePost(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (pathname === "/api/v1/commands") return await this.#command(request, response);
    if (pathname === "/api/v1/reload") return await this.#reload(request, response);
    if (pathname === "/api/v1/prompts") return await this.#submitPrompt(request, response);
    if (pathname === "/api/v1/prompt-acks") return await this.#ackPrompt(request, response);
    sendError(response, 404, "Not found.");
  }

  async #dispatch(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (request.method === "GET") return await this.#routeGet(request, response, pathname);
    if (request.method === "HEAD") return await this.#serveWeb(response, pathname);
    if (request.method === "POST") return await this.#routePost(request, response, pathname);
    sendError(response, 405, "Method not allowed.");
  }

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.#originAllowed(request)) return sendError(response, 403, "Origin is not allowed.");
      const { pathname } = new URL(request.url || "/", this.address);
      await this.#dispatch(request, response, pathname);
    } catch (error) {
      if (error instanceof ContractError) return sendError(response, 400, error.message);
      const message = error instanceof Error ? error.message : "Unknown server error.";
      process.stderr.write(`[pi-pet] request failed: ${message}\n`);
      if (response.headersSent) response.destroy();
      else sendError(response, 500, "Internal server error.");
    }
  }
}
