import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_PET_DEVICES, parseDesktopConfig, parseDeviceName, parseSshTarget } from "../src/desktop/config.ts";

export type PetDevice =
  | { kind: "local"; gippityUrl?: string | undefined }
  | { kind: "ssh"; target: string; gippityUrl?: string | undefined };

export interface DeviceRegistryConfig {
  schemaVersion: 1;
  devices: Record<string, PetDevice>;
  defaultDevices: string[];
}

const ROOT_KEYS = new Set(["schemaVersion", "devices", "defaultDevices"]);
const DEVICE_KEYS = new Set(["kind", "target", "gippityUrl"]);
const LEGACY_ROOT_KEYS = new Set(["schemaVersion", "displays"]);
const LEGACY_DISPLAY_KEYS = new Set(["gippityUrl"]);
const MAX_CONFIG_BYTES = 32 * 1024;

function agentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env["PI_CODING_AGENT_DIR"]?.trim() || join(home, ".pi", "agent");
}

function deviceRegistryPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(agentDirectory(env, home), "pi-pet.json");
}

function parseOptionalUrl(value: unknown): string | undefined {
  return value === undefined ? undefined : parseDesktopConfig({ schemaVersion: 1, gippityUrl: value }).gippityUrl;
}

function parseDevice(name: string, value: unknown): PetDevice {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Pi Pet device ${name} must be an object.`);
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !DEVICE_KEYS.has(key));
  if (unknown) throw new Error(`Pi Pet device ${name} has unknown field: ${unknown}.`);
  const gippityUrl = parseOptionalUrl(input["gippityUrl"]);
  if (input["kind"] === "local") {
    if (name !== "local" || input["target"] !== undefined)
      throw new Error('The local Pi Pet device must be named "local" and cannot have an SSH target.');
    return { kind: "local", ...(gippityUrl ? { gippityUrl } : {}) };
  }
  if (input["kind"] !== "ssh") throw new Error(`Pi Pet device ${name} kind must be local or ssh.`);
  const target = parseSshTarget(input["target"]);
  return { kind: "ssh", target, ...(gippityUrl ? { gippityUrl } : {}) };
}

function parseDeviceNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_PET_DEVICES) {
    throw new Error(`${label} must be an array of at most ${MAX_PET_DEVICES} device names.`);
  }
  const names = value.map(parseDeviceName);
  if (new Set(names).size !== names.length) throw new Error(`${label} must contain unique device names.`);
  return names;
}

function parseLegacyRegistry(input: Record<string, unknown>): DeviceRegistryConfig {
  const unknownRoot = Object.keys(input).find((key) => !LEGACY_ROOT_KEYS.has(key));
  if (unknownRoot) throw new Error(`Pi Pet device registry has unknown field: ${unknownRoot}.`);
  const rawDisplays = input["displays"];
  if (!rawDisplays || typeof rawDisplays !== "object" || Array.isArray(rawDisplays)) {
    throw new Error("Legacy Pi Pet displays must be an object.");
  }
  const entries = Object.entries(rawDisplays);
  if (entries.length > MAX_PET_DEVICES) throw new Error(`Pi Pet supports at most ${MAX_PET_DEVICES} devices.`);
  const devices: DeviceRegistryConfig["devices"] = {};
  for (const [rawName, rawDisplay] of entries) {
    const name = parseDeviceName(rawName);
    if (name === "local") throw new Error("Legacy SSH display local conflicts with the reserved local device.");
    if (!rawDisplay || typeof rawDisplay !== "object" || Array.isArray(rawDisplay)) {
      throw new Error(`Legacy Pi Pet display ${name} must be an object.`);
    }
    const display = rawDisplay as Record<string, unknown>;
    const unknown = Object.keys(display).find((key) => !LEGACY_DISPLAY_KEYS.has(key));
    if (unknown) throw new Error(`Legacy Pi Pet display ${name} has unknown field: ${unknown}.`);
    const gippityUrl = parseOptionalUrl(display["gippityUrl"]);
    devices[name] = { kind: "ssh", target: parseSshTarget(name), ...(gippityUrl ? { gippityUrl } : {}) };
  }
  return { schemaVersion: 1, devices, defaultDevices: Object.keys(devices) };
}

export function parseDeviceRegistry(value: unknown): DeviceRegistryConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi Pet device registry must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported Pi Pet device registry schemaVersion.");
  if (input["displays"] !== undefined) return parseLegacyRegistry(input);
  const unknownRoot = Object.keys(input).find((key) => !ROOT_KEYS.has(key));
  if (unknownRoot) throw new Error(`Pi Pet device registry has unknown field: ${unknownRoot}.`);
  const rawDevices = input["devices"];
  if (!rawDevices || typeof rawDevices !== "object" || Array.isArray(rawDevices)) {
    throw new Error("Pi Pet devices must be an object.");
  }
  const entries = Object.entries(rawDevices);
  if (entries.length > MAX_PET_DEVICES) throw new Error(`Pi Pet supports at most ${MAX_PET_DEVICES} devices.`);
  const devices: DeviceRegistryConfig["devices"] = {};
  for (const [rawName, rawDevice] of entries) {
    const name = parseDeviceName(rawName);
    devices[name] = parseDevice(name, rawDevice);
  }
  const defaultDevices = parseDeviceNames(input["defaultDevices"] ?? [], "Pi Pet defaultDevices");
  const missing = defaultDevices.find((name) => !Object.hasOwn(devices, name));
  if (missing) throw new Error(`Pi Pet default device is not registered: ${missing}.`);
  return { schemaVersion: 1, devices, defaultDevices };
}

export async function readDeviceRegistry(path = deviceRegistryPath()): Promise<DeviceRegistryConfig> {
  let handle: FileHandle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: 1, devices: {}, defaultDevices: [] };
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`Pi Pet device registry must not be a symbolic link: ${path}`);
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
      throw new Error(`Pi Pet device registry must be a bounded regular file: ${path}`);
    }
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      throw new Error(`Pi Pet device registry must have mode 0600: ${path}`);
    }
    return parseDeviceRegistry(JSON.parse(await handle.readFile("utf8")) as unknown);
  } finally {
    await handle.close();
  }
}

export async function writeDeviceRegistry(config: DeviceRegistryConfig, path = deviceRegistryPath()): Promise<void> {
  const normalized = parseDeviceRegistry(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await rm(temporary, { force: true });
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
