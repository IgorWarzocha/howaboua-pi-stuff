import { fileURLToPath } from "node:url";
import { rebuildActivePet } from "./pet-distribution.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const loaded = await rebuildActivePet(packageRoot);
process.stdout.write(`${loaded.catalog.displayName}: ${Object.keys(loaded.catalog.actions).length} actions rebuilt\n`);
