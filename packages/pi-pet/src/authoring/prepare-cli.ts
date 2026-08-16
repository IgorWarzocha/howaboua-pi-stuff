import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { petDataDirectory, prepareUserPet } from "../pet-storage.ts";
import { activeUserPetId } from "./pet-distribution.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const petId = process.argv[2] || (await activeUserPetId());
const petDirectory = await prepareUserPet(packageRoot, petId);
process.stdout.write(`Pet: ${petDirectory}\nRuns: ${join(petDataDirectory(), "runs", petId)}\n`);
