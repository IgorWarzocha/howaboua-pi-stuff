import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type AttentionMode = "normal" | "quiet";
export type PetSize = "small" | "medium" | "large";

export interface AttentionPreferences {
  schemaVersion: 1;
  mode: AttentionMode;
  petSize: PetSize;
  snoozedUntil: string | null;
}

const ATTENTION_KEYS = new Set(["schemaVersion", "mode", "petSize", "snoozedUntil"]);
const MAX_ATTENTION_BYTES = 4_096;
const MAX_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultAttentionPreferences(): AttentionPreferences {
  return { schemaVersion: 1, mode: "normal", petSize: "medium", snoozedUntil: null };
}

function parsePetSize(value: unknown): PetSize {
  const petSize = value ?? "medium";
  if (petSize !== "small" && petSize !== "medium" && petSize !== "large") {
    throw new Error("Desktop petSize must be small, medium, or large.");
  }
  return petSize;
}

export function parseAttentionPreferences(value: unknown): AttentionPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Desktop attention preferences must be an object.");
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !ATTENTION_KEYS.has(key));
  if (unknown) throw new Error(`Desktop attention preferences have unknown field: ${unknown}.`);
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported desktop attention schemaVersion.");
  if (input["mode"] !== "normal" && input["mode"] !== "quiet") {
    throw new Error("Desktop attention mode must be normal or quiet.");
  }
  const petSize = parsePetSize(input["petSize"]);
  if (input["snoozedUntil"] !== null && typeof input["snoozedUntil"] !== "string") {
    throw new Error("Desktop snoozedUntil must be an ISO timestamp or null.");
  }
  if (typeof input["snoozedUntil"] === "string") {
    const snoozedUntil = Date.parse(input["snoozedUntil"]);
    if (!Number.isFinite(snoozedUntil)) throw new Error("Desktop snoozedUntil must be a valid ISO timestamp.");
    if (snoozedUntil - Date.now() > MAX_SNOOZE_MS) {
      throw new Error("Desktop snoozedUntil cannot be more than seven days away.");
    }
  }
  return { schemaVersion: 1, mode: input["mode"], petSize, snoozedUntil: input["snoozedUntil"] };
}

export async function loadAttentionPreferences(path: string): Promise<AttentionPreferences> {
  try {
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_ATTENTION_BYTES) throw new Error("Attention preferences are too large.");
    return parseAttentionPreferences(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultAttentionPreferences();
    throw new Error(`Invalid desktop attention preferences at ${path}: ${(error as Error).message}`);
  }
}

export async function saveAttentionPreferences(path: string, value: AttentionPreferences): Promise<void> {
  const preferences = parseAttentionPreferences(value);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(preferences)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function snoozeUntilTomorrow(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8);
}

export function remainingSnoozeMs(preferences: AttentionPreferences, now = Date.now()): number {
  if (!preferences.snoozedUntil) return 0;
  return Math.max(0, Date.parse(preferences.snoozedUntil) - now);
}
