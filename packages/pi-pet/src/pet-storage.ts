import { randomUUID } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadPet } from "./pet-loader.ts";
import { LIMITS, type PetCatalog, parseActionName } from "./protocol/index.ts";

const CONFIG_BYTES = 16 * 1024;
const WEB_SHELL_FILES = ["app.js", "index.html", "manifest.webmanifest", "pet-icon.svg", "styles.css"] as const;

export interface PetStorageConfig {
  schemaVersion: 1;
  activePet: string;
}

export interface PetRuntime {
  catalog: PetCatalog;
  root: string;
  source: "bundled" | "user";
}

export interface PetRuntimeResolution {
  runtime: PetRuntime;
  warnings: string[];
}

function piAgentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env["PI_CODING_AGENT_DIR"]?.trim() || join(home, ".pi", "agent");
}

export function petDataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(piAgentDirectory(env, home), "pi-pet");
}

function parsePetStorageConfig(value: unknown): PetStorageConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi Pet config must be an object.");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !["schemaVersion", "activePet"].includes(key));
  if (unknown) throw new Error(`Pi Pet config has unknown field: ${unknown}.`);
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported Pi Pet config schemaVersion.");
  return { schemaVersion: 1, activePet: parseActionName(input["activePet"], "active pet") };
}

function parseRepositoryPetConfig(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Repository Pi Pet config must be an object.");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !["schemaVersion", "pet"].includes(key));
  if (unknown) throw new Error(`Repository Pi Pet config has unknown field: ${unknown}.`);
  if (input["schemaVersion"] !== 1) throw new Error("Unsupported repository Pi Pet config schemaVersion.");
  return parseActionName(input["pet"], "repository pet");
}

export async function readPetStorageConfig(dataRoot = petDataDirectory()): Promise<PetStorageConfig | undefined> {
  try {
    const path = join(dataRoot, "config.json");
    const info = await stat(path);
    if (!info.isFile() || info.size > CONFIG_BYTES)
      throw new Error(`Pi Pet config must be a bounded regular file: ${path}`);
    return parsePetStorageConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writePetStorageConfig(config: PetStorageConfig, dataRoot = petDataDirectory()): Promise<void> {
  const normalized = parsePetStorageConfig(config);
  const path = join(dataRoot, "config.json");
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

export async function prepareUserPet(
  packageRoot: string,
  petId: string,
  dataRoot = petDataDirectory(),
): Promise<string> {
  const id = parseActionName(petId, "pet id");
  const source = join(packageRoot, "pets", id);
  const destination = join(dataRoot, "pets", id);
  let exists = true;
  try {
    const info = lstatSync(destination);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`User pet path is not a directory: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }
  if (exists) {
    await loadPet(join(dataRoot, "pets"), id);
    return destination;
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function readCatalog(path: string): PetCatalog {
  const info = statSync(path);
  if (!info.isFile() || info.size > LIMITS.catalogBytes) throw new Error(`Pi Pet catalog must be bounded: ${path}`);
  const catalog = JSON.parse(readFileSync(path, "utf8")) as PetCatalog;
  const id = parseActionName(catalog.id, "catalog pet id");
  if (
    catalog.schemaVersion !== 1 ||
    !catalog.actions ||
    typeof catalog.actions !== "object" ||
    !catalog.actions[catalog.defaultAction]
  ) {
    throw new Error(`Pi Pet catalog is invalid: ${path}`);
  }
  return { ...catalog, id };
}

function syncWebShell(packageRoot: string, destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of WEB_SHELL_FILES) {
    const target = join(destination, file);
    try {
      if (lstatSync(target).isSymbolicLink()) throw new Error(`Pi Pet web shell cannot overwrite a symlink: ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    copyFileSync(join(packageRoot, "dist", "web", file), target);
  }
}

function loadUserPetRuntime(packageRoot: string, petId: string, dataRoot: string): PetRuntime {
  const root = join(dataRoot, "web", petId);
  syncWebShell(packageRoot, root);
  const catalog = readCatalog(join(root, "catalog.json"));
  if (catalog.id !== petId) throw new Error(`Selected pet ${petId} does not match catalog ${catalog.id}.`);
  return { catalog, root, source: "user" };
}

function readRepositoryPet(projectConfigPath: string): string | undefined {
  try {
    const info = statSync(projectConfigPath);
    if (!info.isFile() || info.size > CONFIG_BYTES)
      throw new Error(`Repository Pi Pet config must be bounded: ${projectConfigPath}`);
    return parseRepositoryPetConfig(JSON.parse(readFileSync(projectConfigPath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readGlobalPet(dataRoot: string): string | undefined {
  const configPath = join(dataRoot, "config.json");
  try {
    const info = statSync(configPath);
    if (!info.isFile() || info.size > CONFIG_BYTES) throw new Error(`Pi Pet config must be bounded: ${configPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return parsePetStorageConfig(JSON.parse(readFileSync(configPath, "utf8")) as unknown).activePet;
}

function loadBundledPetRuntime(packageRoot: string): PetRuntime {
  const root = join(packageRoot, "dist", "web");
  return { catalog: readCatalog(join(root, "catalog.json")), root, source: "bundled" };
}

export function resolvePetRuntime(
  packageRoot: string,
  projectConfigPath: string,
  dataRoot = petDataDirectory(),
): PetRuntimeResolution {
  const warnings: string[] = [];
  let repositoryPet: string | undefined;
  try {
    repositoryPet = readRepositoryPet(projectConfigPath);
    if (repositoryPet) return { runtime: loadUserPetRuntime(packageRoot, repositoryPet, dataRoot), warnings };
  } catch (error) {
    warnings.push(`Repository pet unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const globalPet = readGlobalPet(dataRoot);
    if (globalPet && globalPet !== repositoryPet) {
      return { runtime: loadUserPetRuntime(packageRoot, globalPet, dataRoot), warnings };
    }
  } catch (error) {
    warnings.push(`Global pet unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { runtime: loadBundledPetRuntime(packageRoot), warnings };
}

export const petWebShellFiles = WEB_SHELL_FILES;
