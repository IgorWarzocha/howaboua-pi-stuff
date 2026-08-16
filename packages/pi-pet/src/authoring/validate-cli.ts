import { basename, dirname, join, resolve } from "node:path";
import { loadPet } from "../pet-loader.ts";
import { petDataDirectory } from "../pet-storage.ts";
import { activeUserPetId } from "./pet-distribution.ts";

const petId = await activeUserPetId();
const directory = resolve(process.argv[2] || join(petDataDirectory(), "pets", petId));
const loaded = await loadPet(dirname(directory), basename(directory));
process.stdout.write(`${loaded.catalog.displayName}: ${Object.keys(loaded.catalog.actions).length} actions valid\n`);
