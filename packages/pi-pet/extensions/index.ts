import { randomBytes } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { brokerBaseUrl, loadConfig, type PiPetConfig } from "../src/config.ts";
import type { BrokerStatus, PetCatalog, PromptRequest } from "../src/protocol/index.ts";
import { ActivityCoordinator, LatestActivityPublisher } from "./activity.ts";
import { assistantReplyPreview } from "./conversation.ts";

interface BrokerResult {
  ok: boolean;
  error?: string;
  snapshot?: { action?: string; agent?: { connected?: boolean }; displays?: number };
  catalog?: PetCatalog;
  requestedAction?: string;
  resolvedAction?: string;
  pet?: BrokerStatus["pet"];
}

interface StreamEvent {
  event: string;
  data: string;
  id?: string;
}

const LEADING_SPACE_PATTERN = /^ /;
const PROMPT_ID_PATTERN = /^[a-f0-9-]{36}$/;

function sessionId(): string {
  return randomBytes(12).toString("base64url");
}

function parseStreamLine(line: string): { field: string; value: string } | undefined {
  if (!line || line.startsWith(":")) return undefined;
  const separator = line.indexOf(":");
  return {
    field: separator < 0 ? line : line.slice(0, separator),
    value: separator < 0 ? "" : line.slice(separator + 1).replace(LEADING_SPACE_PATTERN, ""),
  };
}

function parseStreamRecord(record: string): StreamEvent | undefined {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of record.split("\n")) {
    const parsed = parseStreamLine(line);
    if (!parsed) continue;
    const { field, value } = parsed;
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return undefined;
  const result: StreamEvent = { event, data: data.join("\n") };
  if (id !== undefined) result.id = id;
  return result;
}

async function readEventStream(
  response: Response,
  signal: AbortSignal,
  receive: (event: StreamEvent) => Promise<void>,
): Promise<void> {
  if (!response.body) throw new Error("Pi Pet broker returned an empty event stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseStreamRecord(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) await receive(event);
        boundary = buffer.indexOf("\n\n");
      }
      if (buffer.length > 65_536) throw new Error("Pi Pet broker sent an oversized event record.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function promptRequest(value: unknown): PromptRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Prompt event is not an object.");
  const input = value as Record<string, unknown>;
  if (typeof input["id"] !== "string" || !PROMPT_ID_PATTERN.test(input["id"]))
    throw new Error("Prompt event id is invalid.");
  if (typeof input["text"] !== "string" || !input["text"].trim() || input["text"].length > 8_000)
    throw new Error("Prompt event text is invalid.");
  if (typeof input["device"] !== "string" || !input["device"].trim() || input["device"].length > 48)
    throw new Error("Prompt event device is invalid.");
  if (typeof input["createdAt"] !== "string") throw new Error("Prompt event createdAt is invalid.");
  return input as unknown as PromptRequest;
}

export default function piPetExtension(pi: ExtensionAPI) {
  let config: PiPetConfig | undefined;
  let baseUrl = "";
  let activeSession = "";
  let context: ExtensionContext | undefined;
  let streamAbort: AbortController | undefined;
  let generation = 0;
  let warnedOffline = false;
  const acceptedPrompts = new Set<string>();
  const processingPrompts = new Set<string>();
  const activity = new ActivityCoordinator();
  let conversationPending = false;
  let conversationReply: string | undefined;

  function headers(): Record<string, string> {
    if (!(config && activeSession))
      throw new Error("Pi Pet is not connected. Run `pi-pet setup`, start `pi-pet serve`, then reload Pi.");
    return {
      authorization: `Bearer ${config.agentToken}`,
      "content-type": "application/json",
      "x-pi-pet-session": activeSession,
    };
  }

  async function request(path: string, init: RequestInit = {}): Promise<BrokerResult> {
    if (!baseUrl) throw new Error("Pi Pet is not configured. Run `pi-pet setup`, then reload Pi.");
    const timeout = AbortSignal.timeout(3_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
      signal,
    });
    const body = (await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))) as BrokerResult;
    if (!(response.ok && body.ok))
      throw new Error(`Pi Pet broker rejected the request: ${body.error || `HTTP ${response.status}`}`);
    return body;
  }

  async function command(
    kind: "activity" | "state" | "action" | "say",
    value: string,
    note?: string,
    signal?: AbortSignal,
  ): Promise<BrokerResult> {
    const body: { kind: string; value: string; note?: string } = { kind, value };
    if (note?.trim()) body.note = note.trim();
    return await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  function warnActivityOffline(): void {
    if (!warnedOffline && context?.hasUI) {
      warnedOffline = true;
      context.ui.setStatus("pi-pet", "pet offline");
    }
  }

  const activityPublisher = new LatestActivityPublisher(async (update) => {
    await command("activity", update.activity, update.note, streamAbort?.signal);
  }, warnActivityOffline);

  async function acknowledge(prompt: PromptRequest, accepted: boolean, detail?: string): Promise<void> {
    const body: { id: string; accepted: boolean; detail?: string } = { id: prompt.id, accepted };
    if (detail) body.detail = detail.slice(0, 280);
    await request("/api/v1/prompt-acks", { method: "POST", body: JSON.stringify(body) });
  }

  function deliverPrompt(prompt: PromptRequest, current: ExtensionContext): void {
    const text = `[Pi Pet prompt from ${prompt.device}]\n\n${prompt.text}`;
    if (current.isIdle()) pi.sendUserMessage(text);
    else pi.sendUserMessage(text, { deliverAs: "followUp" });
  }

  function rememberPrompt(id: string): void {
    acceptedPrompts.add(id);
    if (acceptedPrompts.size > 100) acceptedPrompts.delete(acceptedPrompts.values().next().value as string);
  }

  async function receivePrompt(value: unknown, expectedGeneration: number): Promise<void> {
    const prompt = promptRequest(value);
    if (expectedGeneration !== generation) return;
    if (acceptedPrompts.has(prompt.id)) {
      await acknowledge(prompt, true).catch(() => undefined);
      return;
    }
    const current = context;
    if (processingPrompts.has(prompt.id) || !current) return;
    processingPrompts.add(prompt.id);
    try {
      deliverPrompt(prompt, current);
      conversationPending = true;
      conversationReply = undefined;
      rememberPrompt(prompt.id);
      await acknowledge(prompt, true);
    } catch (error) {
      await acknowledge(prompt, false, error instanceof Error ? error.message : "Pi rejected the prompt.").catch(
        () => undefined,
      );
    } finally {
      processingPrompts.delete(prompt.id);
    }
  }

  async function openConnection(expectedGeneration: number, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${baseUrl}/api/v1/agent/events`, { headers: headers(), signal });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { error?: string };
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    warnedOffline = false;
    context?.ui.setStatus("pi-pet", "pet online");
    activityPublisher.publish(activity.current());
    await readEventStream(response, signal, async (event) => {
      if (event.event === "prompt-request") await receivePrompt(JSON.parse(event.data) as unknown, expectedGeneration);
    });
    if (!signal.aborted) throw new Error("Pi Pet event stream ended.");
  }

  async function waitToReconnect(
    error: unknown,
    expectedGeneration: number,
    signal: AbortSignal,
    delay: number,
  ): Promise<boolean> {
    if (signal.aborted || expectedGeneration !== generation) return false;
    context?.ui.setStatus("pi-pet", "pet reconnecting");
    if (!warnedOffline && context?.hasUI) {
      warnedOffline = true;
      context.ui.notify(`Pi Pet: ${error instanceof Error ? error.message : "connection failed"}`, "warning");
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    return !signal.aborted && expectedGeneration === generation;
  }

  async function connectionLoop(expectedGeneration: number, signal: AbortSignal): Promise<void> {
    let delay = 500;
    while (!signal.aborted && expectedGeneration === generation && config) {
      try {
        await openConnection(expectedGeneration, signal);
        delay = 500;
      } catch (error) {
        if (!(await waitToReconnect(error, expectedGeneration, signal, delay))) return;
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }

  pi.registerTool({
    name: "pet_show",
    label: "Pet",
    description:
      "Set the connected Pi Pet to an action named by its active package. Load the pi-pet skill for action names.",
    promptSnippet: "Set the remote Pi Pet's action.",
    promptGuidelines: [
      "Use pet_show sparingly for meaningful task state or personality; routine lifecycle states update automatically.",
    ],
    parameters: Type.Object({
      action: Type.String({ minLength: 1, maxLength: 64, description: "Action name from the active pet package." }),
      note: Type.Optional(
        Type.String({ minLength: 1, maxLength: 280, description: "Short visible context for the action." }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await command("state", params.action, params.note, signal);
      const resolved = result.resolvedAction || params.action;
      return {
        content: [{ type: "text", text: `Pet action set to ${resolved}.` }],
        details: result.snapshot || {},
      };
    },
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("Pet"))} ${theme.fg("muted", args.action)}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      if (!renderContext.isError) return new Container();
      const message = result.content.find((part) => part.type === "text")?.text || "Pet action failed.";
      return new Text(theme.fg("error", message), 0, 0);
    },
  });

  pi.registerTool({
    name: "pet_reload",
    label: "Pet",
    description: "Validate and hot-reload the active pet manifest and assets after they have been edited.",
    promptSnippet: "Validate and reload the active Pi Pet package.",
    parameters: Type.Object({}),
    async execute() {
      const result = await request("/api/v1/reload", { method: "POST" });
      const actions = result.catalog ? Object.keys(result.catalog.actions).length : 0;
      return {
        content: [
          { type: "text", text: `Pet reloaded: ${result.catalog?.displayName || "package"} (${actions} actions).` },
        ],
        details: { catalog: result.catalog, snapshot: result.snapshot },
      };
    },
    renderCall(_args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("Pet"))} ${theme.fg("muted", "reload")}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      if (!renderContext.isError) return new Container();
      const message = result.content.find((part) => part.type === "text")?.text || "Pet reload failed.";
      return new Text(theme.fg("error", message), 0, 0);
    },
  });

  pi.registerTool({
    name: "pet_say",
    label: "Pet",
    description:
      "Show a short, temporary speech bubble on every connected Pi Pet display. Do not use it to answer a [Pi Pet prompt]; the final assistant reply is displayed automatically.",
    promptSnippet: "Show a short message beside the Pi Pet.",
    promptGuidelines: [
      "Never call pet_say to answer a [Pi Pet prompt from ...] turn; the final assistant reply is already delivered as the pet bubble.",
    ],
    parameters: Type.Object({
      text: Type.String({ minLength: 1, maxLength: 280, description: "Plain-text message to display." }),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await command("say", params.text, undefined, signal);
      return {
        content: [{ type: "text", text: "Pet message displayed." }],
        details: result.snapshot || {},
      };
    },
    renderCall(_args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("Pet"))} ${theme.fg("muted", "say")}`, 0, 0);
    },
    renderResult(result, _options, theme, renderContext) {
      if (!renderContext.isError) return new Container();
      const message = result.content.find((part) => part.type === "text")?.text || "Pet message failed.";
      return new Text(theme.fg("error", message), 0, 0);
    },
  });

  pi.registerCommand("pet-status", {
    description: "Show Pi Pet connection status",
    handler: async (_args, ctx) => {
      try {
        const result = await request("/api/v1/status");
        const displays = result.snapshot?.displays || 0;
        const displayLabel = displays === 1 ? "display" : "displays";
        const agent = result.snapshot?.agent?.connected ? "connected" : "disconnected";
        ctx.ui.notify(
          `${result.pet?.displayName || "Pi Pet"} · ${result.snapshot?.action || "unknown"} · ${displays} ${displayLabel} · ${agent}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Pi Pet status failed.", "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    context = ctx;
    activeSession = sessionId();
    activity.reset();
    activityPublisher.reset();
    conversationPending = false;
    conversationReply = undefined;
    acceptedPrompts.clear();
    processingPrompts.clear();
    streamAbort?.abort();
    streamAbort = new AbortController();
    try {
      config = await loadConfig();
      baseUrl = brokerBaseUrl(config);
      void connectionLoop(generation, streamAbort.signal);
    } catch (error) {
      config = undefined;
      baseUrl = "";
      ctx.ui.setStatus("pi-pet", "pet not configured");
      if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : "Pi Pet configuration failed.", "warning");
    }
  });

  pi.on("agent_start", async () => activityPublisher.publish(activity.agentStarted()));

  pi.on("turn_start", async () => activityPublisher.publish(activity.turnStarted()));

  pi.on("tool_execution_start", async (event) => {
    if (event.toolName.startsWith("pet_")) return;
    activityPublisher.publish(activity.toolStarted(event.toolCallId, event.toolName));
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.toolName.startsWith("pet_")) return;
    activityPublisher.publish(activity.toolEnded(event.toolCallId, event.toolName, event.isError));
  });

  pi.on("message_end", async (event) => {
    if (!conversationPending) return;
    const reply = assistantReplyPreview(event.message);
    if (reply) conversationReply = reply;
  });

  pi.on("agent_settled", async () => {
    activityPublisher.publish(activity.settled());
    if (!conversationPending) return;
    // Pi emits agent_settled only after queued follow-ups, including pet prompts, have completed.
    const reply = conversationReply;
    conversationPending = false;
    conversationReply = undefined;
    if (reply) void command("say", reply).catch(warnActivityOffline);
  });

  pi.on("session_shutdown", async () => {
    generation += 1;
    activityPublisher.reset();
    streamAbort?.abort();
    streamAbort = undefined;
    activity.reset();
    conversationPending = false;
    conversationReply = undefined;
    context?.ui.setStatus("pi-pet", undefined);
    context = undefined;
    activeSession = "";
  });
}
