import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface PiPetConfig {
  schemaVersion: 1;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  activePet: string;
  agentToken: string;
  displayToken: string;
}

export type NetworkMode = "lan" | "loopback";

const DEFAULT_PORT = 43_117;
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["PI_PET_CONFIG"]) return resolve(env["PI_PET_CONFIG"]);
  return join(env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "pi-pet", "config.json");
}

function parseConfig(value: unknown): PiPetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi Pet config must be an object.");
  const input = value as Record<string, unknown>;
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported Pi Pet config schemaVersion.");
  if (input["host"] !== "127.0.0.1" && input["host"] !== "0.0.0.0") {
    throw new Error("Pi Pet host must be 127.0.0.1 or 0.0.0.0.");
  }
  if (!Number.isInteger(input["port"]) || (input["port"] as number) < 1_024 || (input["port"] as number) > 65_535) {
    throw new Error("Pi Pet port must be an integer from 1024 to 65535.");
  }
  if (typeof input["activePet"] !== "string" || !PET_ID_PATTERN.test(input["activePet"])) {
    throw new Error("Pi Pet activePet is invalid.");
  }
  for (const field of ["agentToken", "displayToken"] as const) {
    if (typeof input[field] !== "string" || input[field].length < 32 || input[field].length > 256) {
      throw new Error(`Pi Pet ${field} must contain 32-256 characters.`);
    }
  }
  if (input["agentToken"] === input["displayToken"]) throw new Error("Pi Pet role tokens must be distinct.");
  return input as unknown as PiPetConfig;
}

export async function loadConfig(path = configPath()): Promise<PiPetConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Pi Pet is not configured. Run: pi-pet setup\nExpected config: ${path}`);
    }
    throw error;
  }
  try {
    return parseConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new Error(`Invalid Pi Pet config at ${path}: ${(error as Error).message}`);
  }
}

export async function createConfig(path = configPath()): Promise<PiPetConfig> {
  const config: PiPetConfig = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    activePet: "clawa",
    agentToken: randomBytes(32).toString("base64url"),
    displayToken: randomBytes(32).toString("base64url"),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Pi Pet config already exists: ${path}`);
    }
    throw error;
  }
  return config;
}

export async function setNetworkMode(mode: NetworkMode, path = configPath()): Promise<PiPetConfig> {
  const current = await loadConfig(path);
  const next: PiPetConfig = { ...current, host: mode === "lan" ? "0.0.0.0" : "127.0.0.1" };
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return next;
}

export function brokerBaseUrl(config: PiPetConfig): string {
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  return `http://${host}:${config.port}`;
}
