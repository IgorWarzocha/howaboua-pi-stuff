import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPet } from "../src/pet-loader.ts";

const directory = resolve(process.argv[2] || fileURLToPath(new URL("../pets/clawa", import.meta.url)));
const loaded = await loadPet(dirname(directory), basename(directory));
process.stdout.write(`${loaded.catalog.displayName}: ${Object.keys(loaded.catalog.actions).length} actions valid\n`);
