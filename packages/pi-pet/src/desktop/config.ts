import { constants as fsConstants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DesktopConfig {
  schemaVersion: 1;
  gippityUrl: string;
}

const CONFIG_KEYS = new Set(["schemaVersion", "gippityUrl"]);
const MAX_CONFIG_BYTES = 16_384;

function desktopConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  if (env["PI_PET_DESKTOP_CONFIG"]) return resolve(env["PI_PET_DESKTOP_CONFIG"]);
  if (platform === "win32") {
    return join(env["APPDATA"] || join(home, "AppData", "Roaming"), "PiPetDesktop", "config.json");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Pi Pet Desktop", "config.json");
  }
  return join(env["XDG_CONFIG_HOME"] || join(home, ".config"), "pi-pet-desktop", "config.json");
}

export function desktopStateDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  if (platform === "win32") {
    return join(env["LOCALAPPDATA"] || join(home, "AppData", "Local"), "PiPetDesktop", "state");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Pi Pet Desktop", "state");
  }
  return join(env["XDG_STATE_HOME"] || join(home, ".local", "state"), "pi-pet-desktop");
}

function parseGippityUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("gippityUrl must be a bounded HTTPS URL.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("gippityUrl must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("gippityUrl must be an HTTPS origin without credentials, query, or fragment.");
  }
  if (url.pathname !== "/") throw new Error("gippityUrl must not contain a path.");
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
  return { schemaVersion: 1, gippityUrl: parseGippityUrl(input["gippityUrl"]) };
}

function configFromEnvironment(env: NodeJS.ProcessEnv): DesktopConfig | undefined {
  const gippityUrl = env["PI_PET_GIPPITY_URL"];
  return gippityUrl ? parseDesktopConfig({ schemaVersion: 1, gippityUrl }) : undefined;
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

export function desktopDisplayUrl(config: DesktopConfig, attention: "normal" | "quiet" = "normal"): string {
  const url = new URL(config.gippityUrl);
  url.pathname = "/_gippity/apps/pi-pet/";
  url.searchParams.set("shell", "desktop");
  if (attention === "quiet") url.searchParams.set("attention", "quiet");
  return url.toString();
}
