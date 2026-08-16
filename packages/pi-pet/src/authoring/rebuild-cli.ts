import { fileURLToPath } from "node:url";
import { activeUserPetId, rebuildUserPet } from "./pet-distribution.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const petId = process.argv[2] || (await activeUserPetId());
const loaded = await rebuildUserPet(packageRoot, petId);
process.stdout.write(`${loaded.catalog.displayName}: ${Object.keys(loaded.catalog.actions).length} actions rebuilt\n`);
