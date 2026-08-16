import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { readImageSize } from "./pet-image-size.ts";
import {
  ContractError,
  isSafeRelativeAssetPath,
  LIMITS,
  type PetAction,
  type PetCatalog,
  type PetFrame,
  parseActionName,
} from "./protocol/index.ts";

const CELL = { width: 192, height: 208 } as const;
const STANDARD_ROWS = [
  ["idle", 0, [280, 110, 110, 140, 140, 320]],
  ["running-right", 1, [120, 120, 120, 120, 120, 120, 120, 220]],
  ["running-left", 2, [120, 120, 120, 120, 120, 120, 120, 220]],
  ["waving", 3, [140, 140, 140, 280]],
  ["jumping", 4, [140, 140, 140, 140, 280]],
  ["failed", 5, [140, 140, 140, 140, 140, 140, 140, 240]],
  ["waiting", 6, [150, 150, 150, 150, 150, 260]],
  ["running", 7, [120, 120, 120, 120, 120, 220]],
  ["review", 8, [150, 150, 150, 150, 150, 280]],
] as const;

const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  active: "running",
  error: "failed",
  hello: "waving",
  settled: "review",
  success: "jumping",
  thinking: "running",
  working: "running",
});

export interface LoadedPet {
  directory: string;
  catalog: PetCatalog;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ContractError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

async function readJson(path: string, maximumBytes: number): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maximumBytes) throw new ContractError(`${path} is not a bounded regular file.`);
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function atlasFrames(row: number, durations: readonly number[]): PetFrame[] {
  return durations.map((durationMs, column) => ({
    x: column * CELL.width,
    y: row * CELL.height,
    width: CELL.width,
    height: CELL.height,
    durationMs,
  }));
}

function parseCodexManifest(value: unknown): PetCatalog {
  const manifest = record(value, "pet.json");
  const id = parseActionName(manifest["id"], "pet id");
  if (
    typeof manifest["displayName"] !== "string" ||
    !manifest["displayName"].trim() ||
    manifest["displayName"].length > 80
  ) {
    throw new ContractError("pet.json displayName must contain 1-80 characters.");
  }
  if (
    typeof manifest["description"] !== "string" ||
    !manifest["description"].trim() ||
    manifest["description"].length > 280
  ) {
    throw new ContractError("pet.json description must contain 1-280 characters.");
  }
  if (manifest["spriteVersionNumber"] !== 2) throw new ContractError("Only Codex spriteVersionNumber 2 is supported.");
  if (typeof manifest["spritesheetPath"] !== "string" || !isSafeRelativeAssetPath(manifest["spritesheetPath"])) {
    throw new ContractError("pet.json spritesheetPath must be a safe relative path.");
  }
  const actions: Record<string, PetAction> = {};
  const directions: Record<string, PetAction> = {};
  for (const [name, row, durations] of STANDARD_ROWS) {
    actions[name] = { name, asset: manifest["spritesheetPath"], frames: atlasFrames(row, durations), loop: true };
  }
  for (let index = 0; index < 16; index += 1) {
    const degrees = index * 22.5;
    const name = `look-${String(degrees).padStart(3, "0").replace(".5", "_5")}`;
    const row = index < 8 ? 9 : 10;
    const column = index % 8;
    directions[name] = {
      name,
      asset: manifest["spritesheetPath"],
      frames: [{ x: column * CELL.width, y: row * CELL.height, ...CELL, durationMs: 1_000 }],
      loop: true,
    };
  }
  return {
    schemaVersion: 1,
    id,
    displayName: manifest["displayName"].trim(),
    description: manifest["description"].trim(),
    defaultAction: "idle",
    canvas: { ...CELL },
    actions,
    aliases: { ...ALIASES },
    directions,
  };
}

function parseOverlayAction(name: string, value: unknown): PetAction {
  const input = record(value, `action ${name}`);
  const allowed = new Set(["asset", "frames", "loop", "next"]);
  for (const key of Object.keys(input))
    if (!allowed.has(key)) throw new ContractError(`action ${name} has unknown field: ${key}.`);
  if (typeof input["asset"] !== "string" || !isSafeRelativeAssetPath(input["asset"])) {
    throw new ContractError(`action ${name} asset must be a safe relative path.`);
  }
  if (!Array.isArray(input["frames"]) || input["frames"].length === 0 || input["frames"].length > LIMITS.frameCount) {
    throw new ContractError(`action ${name} must have 1-${LIMITS.frameCount} frames.`);
  }
  const frames = input["frames"].map((rawFrame, index) => {
    const frame = record(rawFrame, `action ${name} frame ${index}`);
    const keys = new Set(["x", "y", "width", "height", "durationMs"]);
    for (const key of Object.keys(frame))
      if (!keys.has(key)) throw new ContractError(`action ${name} frame ${index} has unknown field: ${key}.`);
    const width = integer(frame["width"], "frame width", 1, 4_096);
    const height = integer(frame["height"], "frame height", 1, 4_096);
    if (width * height > LIMITS.decodedPixels) throw new ContractError(`action ${name} frame ${index} is too large.`);
    return {
      x: integer(frame["x"], "frame x", 0, 32_768),
      y: integer(frame["y"], "frame y", 0, 32_768),
      width,
      height,
      durationMs: integer(frame["durationMs"], "frame durationMs", 16, 60_000),
    };
  });
  if (typeof input["loop"] !== "boolean") throw new ContractError(`action ${name} loop must be a boolean.`);
  const action: PetAction = { name, asset: input["asset"], frames, loop: input["loop"] };
  if (input["next"] !== undefined) action.next = parseActionName(input["next"], `action ${name} next`);
  return action;
}

async function readOverlay(directory: string): Promise<Record<string, unknown> | undefined> {
  const path = join(directory, "pet.pi.json");
  try {
    return record(await readJson(path, LIMITS.manifestBytes), "pet.pi.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function assertOverlayKeys(overlay: Record<string, unknown>): void {
  const allowed = new Set(["schemaVersion", "defaultAction", "actions", "aliases"]);
  for (const key of Object.keys(overlay))
    if (!allowed.has(key)) throw new ContractError(`pet.pi.json has unknown field: ${key}.`);
  if (overlay["schemaVersion"] !== 1) throw new ContractError("pet.pi.json schemaVersion must be 1.");
}

function applyOverlayActions(value: unknown, catalog: PetCatalog): void {
  if (value === undefined) return;
  for (const [rawName, actionValue] of Object.entries(record(value, "pet.pi.json actions"))) {
    const name = parseActionName(rawName, "action name");
    catalog.actions[name] = parseOverlayAction(name, actionValue);
    delete catalog.aliases[name];
  }
}

function applyOverlayAliases(value: unknown, catalog: PetCatalog): void {
  if (value === undefined) return;
  for (const [rawName, rawTarget] of Object.entries(record(value, "pet.pi.json aliases"))) {
    const name = parseActionName(rawName, "alias name");
    if (catalog.actions[name]) throw new ContractError(`Alias ${name} conflicts with an action of the same name.`);
    catalog.aliases[name] = parseActionName(rawTarget, `alias ${name} target`);
  }
}

function validateCatalogLinks(catalog: PetCatalog): void {
  if (!catalog.actions[catalog.defaultAction])
    throw new ContractError(`Unknown defaultAction: ${catalog.defaultAction}.`);
  for (const action of Object.values(catalog.actions)) {
    if (action.next !== undefined && !catalog.actions[action.next])
      throw new ContractError(`Action ${action.name} has unknown next action: ${action.next}.`);
  }
  for (const [alias, target] of Object.entries(catalog.aliases)) {
    if (!catalog.actions[target]) throw new ContractError(`Alias ${alias} has unknown target action: ${target}.`);
  }
}

async function applyOverlay(directory: string, catalog: PetCatalog): Promise<void> {
  const overlay = await readOverlay(directory);
  if (!overlay) return;
  assertOverlayKeys(overlay);
  applyOverlayActions(overlay["actions"], catalog);
  applyOverlayAliases(overlay["aliases"], catalog);
  if (overlay["defaultAction"] !== undefined)
    catalog.defaultAction = parseActionName(overlay["defaultAction"], "defaultAction");
  validateCatalogLinks(catalog);
}

async function assertAsset(root: string, asset: string): Promise<{ width: number; height: number }> {
  const resolved = await realpath(join(root, asset));
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`))
    throw new ContractError(`Asset escapes pet directory: ${asset}.`);
  const info = await stat(resolved);
  if (!info.isFile() || info.size === 0 || info.size > LIMITS.assetBytes)
    throw new ContractError(`Asset is not a bounded regular file: ${asset}.`);
  const dimensions = await readImageSize(resolved);
  if (dimensions.width * dimensions.height > LIMITS.decodedPixels)
    throw new ContractError(`Asset has too many decoded pixels: ${asset}.`);
  return dimensions;
}

function assertFramesInside(asset: string, actions: PetAction[], width: number, height: number): void {
  for (const action of actions) {
    for (const frame of action.frames) {
      if (frame.x + frame.width > width || frame.y + frame.height > height) {
        throw new ContractError(`Action ${action.name} has a frame outside ${asset}.`);
      }
    }
  }
}

async function assertAssets(directory: string, catalog: PetCatalog, codexSpritesheet: string): Promise<void> {
  const root = await realpath(directory);
  const visualEntries = [...Object.values(catalog.actions), ...Object.values(catalog.directions)];
  const assets = new Set(visualEntries.map((action) => action.asset));
  for (const asset of assets) {
    const dimensions = await assertAsset(root, asset);
    if (asset === codexSpritesheet && (dimensions.width !== 1_536 || dimensions.height !== 2_288)) {
      throw new ContractError(`Codex v2 spritesheet must be 1536x2288; got ${dimensions.width}x${dimensions.height}.`);
    }
    assertFramesInside(
      asset,
      visualEntries.filter((candidate) => candidate.asset === asset),
      dimensions.width,
      dimensions.height,
    );
  }
}

export async function loadPet(petsRoot: string, petId: string): Promise<LoadedPet> {
  const safeId = parseActionName(petId, "active pet");
  const root = await realpath(resolve(petsRoot));
  const directory = await realpath(join(root, safeId));
  if (directory !== root && !directory.startsWith(`${root}${sep}`))
    throw new ContractError("Active pet escapes the pets directory.");
  const manifest = await readJson(join(directory, "pet.json"), LIMITS.manifestBytes);
  const catalog = parseCodexManifest(manifest);
  if (catalog.id !== safeId)
    throw new ContractError(`Active pet directory ${safeId} does not match manifest id ${catalog.id}.`);
  await applyOverlay(directory, catalog);
  const codexSpritesheet = record(manifest, "pet.json")["spritesheetPath"] as string;
  await assertAssets(directory, catalog, codexSpritesheet);
  return { directory, catalog };
}
