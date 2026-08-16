import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { LoadedPet } from "../pet-loader.ts";
import { loadPet } from "../pet-loader.ts";
import { petDataDirectory, petWebShellFiles, readPetStorageConfig, writePetStorageConfig } from "../pet-storage.ts";
import { isSafeRelativeAssetPath, type PetCatalog } from "../protocol/index.ts";

function catalogAssets(catalog: PetCatalog): Set<string> {
  return new Set(
    [...Object.values(catalog.actions), ...Object.values(catalog.directions)].map((action) => action.asset),
  );
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function retainedImageAsset(value: unknown): string | undefined {
  const asset = object(value)?.["asset"];
  if (typeof asset !== "string" || !isSafeRelativeAssetPath(asset)) return undefined;
  return [".png", ".webp"].includes(extname(asset).toLowerCase()) ? asset : undefined;
}

function retainedImageAssets(value: unknown): Set<string> {
  const assets = new Set<string>();
  const catalog = object(value);
  if (!catalog) return assets;
  for (const groupName of ["actions", "directions"]) {
    const group = object(catalog[groupName]);
    if (!group) continue;
    for (const entry of Object.values(group)) {
      const asset = retainedImageAsset(entry);
      if (asset) assets.add(asset);
    }
  }
  return assets;
}

async function previousAssets(catalogPath: string): Promise<Set<string>> {
  try {
    return retainedImageAssets(JSON.parse(await readFile(catalogPath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return new Set();
    throw error;
  }
}

export async function writePetDistribution(webRoot: string, loaded: LoadedPet): Promise<void> {
  const catalogPath = join(webRoot, "catalog.json");
  const oldAssets = await previousAssets(catalogPath);
  const nextAssets = catalogAssets(loaded.catalog);

  for (const asset of nextAssets) {
    const destination = join(webRoot, asset);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(loaded.directory, asset), destination);
  }
  await writeFile(catalogPath, `${JSON.stringify(loaded.catalog)}\n`);
  for (const asset of oldAssets) {
    if (!nextAssets.has(asset)) await rm(join(webRoot, asset), { force: true });
  }
}

export async function activeUserPetId(dataRoot = petDataDirectory()): Promise<string> {
  return (await readPetStorageConfig(dataRoot))?.activePet || "clawa";
}

export async function rebuildUserPet(
  packageRoot: string,
  petId: string,
  dataRoot = petDataDirectory(),
): Promise<LoadedPet> {
  const loaded = await loadPet(join(dataRoot, "pets"), petId);
  const webRoot = join(dataRoot, "web", loaded.catalog.id);
  await mkdir(webRoot, { recursive: true, mode: 0o700 });
  for (const file of petWebShellFiles) await cp(join(packageRoot, "dist", "web", file), join(webRoot, file));
  await writePetDistribution(webRoot, loaded);
  await writePetStorageConfig({ schemaVersion: 1, activePet: loaded.catalog.id }, dataRoot);
  return loaded;
}
