import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoadedPet } from "../pet-loader.ts";
import { loadPet } from "../pet-loader.ts";
import { petDataDirectory, petWebShellFiles, readPetStorageConfig, writePetStorageConfig } from "../pet-storage.ts";
import type { PetCatalog } from "../protocol/index.ts";

function catalogAssets(catalog: PetCatalog): Set<string> {
  return new Set(
    [...Object.values(catalog.actions), ...Object.values(catalog.directions)].map((action) => action.asset),
  );
}

export async function writePetDistribution(webRoot: string, loaded: LoadedPet): Promise<void> {
  for (const asset of catalogAssets(loaded.catalog)) {
    const destination = join(webRoot, asset);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(loaded.directory, asset), destination);
  }
  await writeFile(join(webRoot, "catalog.json"), `${JSON.stringify(loaded.catalog)}\n`);
}

async function publishPetRoot(staging: string, destination: string): Promise<void> {
  const backup = `${destination}.${process.pid}.${randomUUID()}.old`;
  let movedPrevious = false;
  try {
    await rename(destination, backup);
    movedPrevious = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, destination);
  } catch (publishError) {
    if (movedPrevious) {
      try {
        await rename(backup, destination);
      } catch (restoreError) {
        if (!["EEXIST", "ENOTEMPTY"].includes((restoreError as NodeJS.ErrnoException).code || "")) {
          throw new AggregateError(
            [publishError, restoreError],
            `Could not publish or restore pet root: ${destination}`,
          );
        }
        await rm(backup, { recursive: true, force: true });
      }
    }
    throw publishError;
  }
  if (movedPrevious) await rm(backup, { recursive: true, force: true });
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
  const staging = `${webRoot}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    for (const file of petWebShellFiles) await cp(join(packageRoot, "dist", "web", file), join(staging, file));
    await writePetDistribution(staging, loaded);
    await publishPetRoot(staging, webRoot);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await writePetStorageConfig({ schemaVersion: 1, activePet: loaded.catalog.id }, dataRoot);
  return loaded;
}
