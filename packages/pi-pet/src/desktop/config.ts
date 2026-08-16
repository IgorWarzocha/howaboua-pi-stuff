import { constants as fsConstants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseDeviceName } from "../protocol/index.ts";

export interface DesktopConfig {
  schemaVersion: 1;
  brokerUrl: string;
  displayToken: string;
}

const CONFIG_KEYS = new Set(["schemaVersion", "brokerUrl", "displayToken"]);
const MAX_CONFIG_BYTES = 16_384;

function desktopConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["PI_PET_DESKTOP_CONFIG"]) return resolve(env["PI_PET_DESKTOP_CONFIG"]);
  return join(env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "pi-pet-desktop", "config.json");
}

function parseBrokerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("brokerUrl must be a bounded HTTP URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("brokerUrl must be a valid HTTP URL.");
  }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) {
    throw new Error("brokerUrl must be an HTTP origin without credentials, query, or fragment.");
  }
  if (url.pathname !== "/") throw new Error("brokerUrl must not contain a path.");
  return url.origin;
}

export function parseDesktopConfig(value: unknown): DesktopConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi Pet desktop config must be an object.");
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !CONFIG_KEYS.has(key));
  if (unknown) throw new Error(`Pi Pet desktop config has unknown field: ${unknown}.`);
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported Pi Pet desktop config schemaVersion.");
  if (
    typeof input["displayToken"] !== "string" ||
    input["displayToken"].length < 32 ||
    input["displayToken"].length > 256
  ) {
    throw new Error("displayToken must contain 32-256 characters.");
  }
  return {
    schemaVersion: 1,
    brokerUrl: parseBrokerUrl(input["brokerUrl"]),
    displayToken: input["displayToken"],
  };
}

function configFromEnvironment(env: NodeJS.ProcessEnv): DesktopConfig | undefined {
  const brokerUrl = env["PI_PET_DESKTOP_BROKER_URL"];
  const displayToken = env["PI_PET_DISPLAY_TOKEN"];
  if (!(brokerUrl || displayToken)) return undefined;
  if (!(brokerUrl && displayToken)) {
    throw new Error("PI_PET_DESKTOP_BROKER_URL and PI_PET_DISPLAY_TOKEN must be set together.");
  }
  return parseDesktopConfig({ schemaVersion: 1, brokerUrl, displayToken });
}

async function openDesktopConfig(path: string): Promise<FileHandle> {
  try {
    return await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Pi Pet desktop is not configured: ${path}`);
    }
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`Pi Pet desktop config must not be a symbolic link: ${path}`);
    }
    throw error;
  }
}

async function validateConfigFile(handle: FileHandle, path: string): Promise<void> {
  const info = await handle.stat();
  if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
    throw new Error(`Pi Pet desktop config must be a regular file no larger than ${MAX_CONFIG_BYTES} bytes: ${path}`);
  }
  if (process.platform === "win32") return;
  if ((info.mode & 0o077) !== 0) throw new Error(`Pi Pet desktop config must have mode 0600: ${path}`);
  if (process.getuid && info.uid !== process.getuid()) {
    throw new Error(`Pi Pet desktop config must be owned by the current user: ${path}`);
  }
}

export async function loadDesktopConfig(
  path = desktopConfigPath(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<DesktopConfig> {
  const environmentConfig = configFromEnvironment(env);
  if (environmentConfig) return environmentConfig;
  const handle = await openDesktopConfig(path);
  try {
    await validateConfigFile(handle, path);
    const raw = await handle.readFile("utf8");
    return parseDesktopConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new Error(`Invalid Pi Pet desktop config at ${path}: ${(error as Error).message}`);
  } finally {
    await handle.close();
  }
}

export function desktopDisplayUrl(
  config: DesktopConfig,
  attention: "normal" | "quiet" = "normal",
  device = "desktop",
): string {
  const url = new URL(config.brokerUrl);
  url.searchParams.set("shell", "desktop");
  url.searchParams.set("device", parseDeviceName(device, "desktop device"));
  if (attention === "quiet") url.searchParams.set("attention", "quiet");
  url.hash = new URLSearchParams({ token: config.displayToken }).toString();
  return url.toString();
}
