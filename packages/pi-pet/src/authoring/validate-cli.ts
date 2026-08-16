import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPet } from "../pet-loader.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(process.argv[2] || join(packageRoot, "pets", "clawa"));
const loaded = await loadPet(dirname(directory), basename(directory));
process.stdout.write(`${loaded.catalog.displayName}: ${Object.keys(loaded.catalog.actions).length} actions valid\n`);
