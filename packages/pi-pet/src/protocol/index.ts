export const ACTION_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const DEVICE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,47}$/;

export const AGENT_ACTIVITIES = ["idle", "working", "waiting", "failed", "settled"] as const;
export type AgentActivity = (typeof AGENT_ACTIVITIES)[number];

export const LIMITS = Object.freeze({
  actionName: 64,
  bubbleText: 280,
  deviceName: 48,
  noteText: 280,
  promptText: 8_000,
  requestBodyBytes: 16_384,
  manifestBytes: 131_072,
  assetBytes: 16 * 1024 * 1024,
  frameCount: 64,
  decodedPixels: 16_000_000,
});

export interface PetFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
}

export interface PetAction {
  name: string;
  asset: string;
  frames: PetFrame[];
  loop: boolean;
  next?: string;
}

export interface PetCatalog {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description: string;
  defaultAction: string;
  canvas: { width: number; height: number };
  actions: Record<string, PetAction>;
  aliases: Record<string, string>;
  directions: Record<string, PetAction>;
}

export interface PetBubble {
  text: string;
  expiresAt: string;
}

export interface BrokerSnapshot {
  protocol: "pi-pet/1";
  revision: number;
  activity: AgentActivity;
  action: string;
  note?: string;
  bubble?: PetBubble;
  updatedAt: string;
  agent: { connected: boolean; sessionId?: string };
  displays: number;
}

export interface BrokerStatus {
  ok: true;
  pet: {
    id: string;
    displayName: string;
    actions: number;
  };
  snapshot: BrokerSnapshot;
}

export type PetCommand =
  | { kind: "activity"; value: AgentActivity; note?: string }
  | { kind: "state"; value: string; note?: string }
  | { kind: "action"; value: string; note?: string }
  | { kind: "say"; value: string };

export interface PromptRequest {
  id: string;
  text: string;
  device: string;
  createdAt: string;
}

export interface PromptAck {
  id: string;
  accepted: boolean;
  detail?: string;
}

export class ContractError extends Error {
  override readonly name = "ContractError";
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ContractError(`${label} has unknown field: ${unknown[0]}.`);
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new ContractError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new ContractError(`${label} cannot be empty.`);
  if (normalized.length > max) throw new ContractError(`${label} exceeds ${max} characters.`);
  return normalized;
}

export function parseActionName(value: unknown, label = "action"): string {
  const action = boundedString(value, label, LIMITS.actionName);
  if (!ACTION_NAME_PATTERN.test(action)) {
    throw new ContractError(`${label} must use lowercase letters, numbers, dots, underscores, or hyphens.`);
  }
  return action;
}

export function parseDeviceName(value: unknown, label = "device"): string {
  const device = boundedString(value, label, LIMITS.deviceName);
  if (!DEVICE_NAME_PATTERN.test(device)) throw new ContractError(`${label} contains unsupported characters.`);
  return device;
}

export function parseAgentActivity(value: unknown, label = "activity"): AgentActivity {
  if (typeof value !== "string" || !AGENT_ACTIVITIES.includes(value as AgentActivity)) {
    throw new ContractError(`${label} must be idle, working, waiting, failed, or settled.`);
  }
  return value as AgentActivity;
}

export function parsePetCommand(value: unknown): PetCommand {
  const input = object(value, "command");
  exactKeys(input, ["kind", "value", "note"], "command");
  if (input["kind"] === "say") {
    if (input["note"] !== undefined) throw new ContractError("say commands do not accept note.");
    return { kind: "say", value: boundedString(input["value"], "value", LIMITS.bubbleText) };
  }
  if (input["kind"] === "activity") {
    const result: PetCommand = { kind: "activity", value: parseAgentActivity(input["value"], "value") };
    if (input["note"] !== undefined) result.note = boundedString(input["note"], "note", LIMITS.noteText);
    return result;
  }
  if (input["kind"] !== "state" && input["kind"] !== "action") {
    throw new ContractError("kind must be activity, state, action, or say.");
  }
  const actionValue = parseActionName(input["value"], "value");
  if (input["note"] !== undefined)
    return { kind: input["kind"], value: actionValue, note: boundedString(input["note"], "note", LIMITS.noteText) };
  return { kind: input["kind"], value: actionValue };
}

export function parsePromptSubmission(value: unknown): { text: string; device: string } {
  const input = object(value, "prompt");
  exactKeys(input, ["text", "device"], "prompt");
  const device = parseDeviceName(input["device"]);
  return {
    text: boundedString(input["text"], "text", LIMITS.promptText),
    device,
  };
}

export function parsePromptAck(value: unknown): PromptAck {
  const input = object(value, "ack");
  exactKeys(input, ["id", "accepted", "detail"], "ack");
  const id = boundedString(input["id"], "id", 64);
  if (typeof input["accepted"] !== "boolean") throw new ContractError("accepted must be a boolean.");
  const result: PromptAck = { id, accepted: input["accepted"] };
  if (input["detail"] !== undefined) result.detail = boundedString(input["detail"], "detail", LIMITS.noteText);
  return result;
}

export function isSafeRelativeAssetPath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
