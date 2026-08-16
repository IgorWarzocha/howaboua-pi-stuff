import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { LoadedPet } from "../pet-loader.ts";
import { loadPet } from "../pet-loader.ts";
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

export async function writePetDistribution(packageRoot: string, loaded: LoadedPet): Promise<void> {
  const webRoot = join(packageRoot, "dist", "web");
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

export async function rebuildActivePet(packageRoot: string): Promise<LoadedPet> {
  const loaded = await loadPet(join(packageRoot, "pets"), "clawa");
  await writePetDistribution(packageRoot, loaded);
  return loaded;
}
