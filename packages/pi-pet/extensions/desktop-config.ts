import { constants as fsConstants } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseDesktopConfig } from "../src/desktop/config.ts";

export interface RemoteDesktopConfig {
  schemaVersion: 1;
  displays: Record<string, { gippityUrl?: string | undefined }>;
}

const ROOT_KEYS = new Set(["schemaVersion", "displays"]);
const DISPLAY_KEYS = new Set(["gippityUrl"]);
const SSH_TARGET_PATTERN = /^(?!-)[a-zA-Z0-9_.@:-]{1,255}$/;
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_DISPLAYS = 8;

function agentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env["PI_CODING_AGENT_DIR"]?.trim() || join(home, ".pi", "agent");
}

function remoteDesktopConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(agentDirectory(env, home), "pi-pet.json");
}

export function parseSshTarget(value: string): string {
  const target = value.trim();
  if (!SSH_TARGET_PATTERN.test(target) || ["__proto__", "constructor", "prototype"].includes(target)) {
    throw new Error("SSH target must be one host or ~/.ssh/config alias without command options.");
  }
  return target;
}

export function parseRemoteDesktopConfig(value: unknown): RemoteDesktopConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi Pet remote desktop config must be an object.");
  }
  const input = value as Record<string, unknown>;
  const unknownRoot = Object.keys(input).find((key) => !ROOT_KEYS.has(key));
  if (unknownRoot) throw new Error(`Pi Pet remote desktop config has unknown field: ${unknownRoot}.`);
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported Pi Pet remote desktop config schemaVersion.");
  const rawDisplays = input["displays"];
  if (!rawDisplays || typeof rawDisplays !== "object" || Array.isArray(rawDisplays)) {
    throw new Error("Pi Pet remote desktop displays must be an object.");
  }
  const entries = Object.entries(rawDisplays);
  if (entries.length > MAX_DISPLAYS) throw new Error(`Pi Pet supports at most ${MAX_DISPLAYS} attached displays.`);
  const displays: RemoteDesktopConfig["displays"] = {};
  for (const [rawTarget, rawDisplay] of entries) {
    const target = parseSshTarget(rawTarget);
    if (!rawDisplay || typeof rawDisplay !== "object" || Array.isArray(rawDisplay)) {
      throw new Error(`Pi Pet display ${target} must be an object.`);
    }
    const display = rawDisplay as Record<string, unknown>;
    const unknown = Object.keys(display).find((key) => !DISPLAY_KEYS.has(key));
    if (unknown) throw new Error(`Pi Pet display ${target} has unknown field: ${unknown}.`);
    const rawUrl = display["gippityUrl"];
    displays[target] =
      rawUrl === undefined
        ? {}
        : { gippityUrl: parseDesktopConfig({ schemaVersion: 1, gippityUrl: rawUrl }).gippityUrl };
  }
  return { schemaVersion: 1, displays };
}

export async function readRemoteDesktopConfig(path = remoteDesktopConfigPath()): Promise<RemoteDesktopConfig> {
  let handle: FileHandle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, displays: {} };
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`Pi Pet remote desktop config must not be a symbolic link: ${path}`);
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
      throw new Error(`Pi Pet remote desktop config must be a bounded regular file: ${path}`);
    }
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      throw new Error(`Pi Pet remote desktop config must have mode 0600: ${path}`);
    }
    return parseRemoteDesktopConfig(JSON.parse(await handle.readFile("utf8")) as unknown);
  } finally {
    await handle.close();
  }
}

export async function writeRemoteDesktopConfig(
  config: RemoteDesktopConfig,
  path = remoteDesktopConfigPath(),
): Promise<void> {
  const normalized = parseRemoteDesktopConfig(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await rm(temporary, { force: true });
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
