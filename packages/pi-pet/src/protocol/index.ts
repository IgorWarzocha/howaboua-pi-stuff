export const ACTION_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const LIMITS = Object.freeze({
  actionName: 64,
  noteText: 280,
  manifestBytes: 131_072,
  catalogBytes: 262_144,
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

export interface PetState {
  schemaVersion: 1;
  pet: string;
  revision: number;
  action: string;
  note?: string;
}

export class ContractError extends Error {
  override readonly name = "ContractError";
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
  if (action === "list") throw new ContractError(`${label} cannot use the reserved pet_show discovery name list.`);
  if (!ACTION_NAME_PATTERN.test(action)) {
    throw new ContractError(`${label} must use lowercase letters, numbers, dots, underscores, or hyphens.`);
  }
  return action;
}

export function parseNote(value: unknown): string | undefined {
  return value === undefined ? undefined : boundedString(value, "note", LIMITS.noteText);
}

export function isSafeRelativeAssetPath(value: string): boolean {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}
