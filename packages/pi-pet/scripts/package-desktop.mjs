import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronRoot = join(root, "node_modules", "electron", "dist");
const output = join(root, "release", `pi-pet-desktop-${process.platform}-${process.arch}`);
const appDirectory = join(output, "app");
const runtimeDirectory = join(output, "runtime");

const packageManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const expectedElectronVersion = packageManifest.devDependencies?.electron;
if (typeof expectedElectronVersion !== "string")
  throw new Error("package.json must pin the Electron development dependency.");
const electronVersion = (await readFile(join(electronRoot, "version"), "utf8")).trim();
if (electronVersion !== expectedElectronVersion) {
  throw new Error(`Expected Electron ${expectedElectronVersion}, found ${electronVersion}.`);
}

await rm(output, { recursive: true, force: true });
await mkdir(appDirectory, { recursive: true });
await cp(electronRoot, runtimeDirectory, { recursive: true, force: true });
await cp(join(root, "dist", "desktop", "main.mjs"), join(appDirectory, "main.mjs"));
await cp(join(root, "dist", "desktop", "preload.cjs"), join(appDirectory, "preload.cjs"));
await writeFile(
  join(appDirectory, "package.json"),
  `${JSON.stringify({ name: "pi-pet-desktop", version: "0.1.0", type: "module", main: "main.mjs" }, null, 2)}\n`,
);
if (process.platform !== "win32") await chmod(join(runtimeDirectory, "electron"), 0o755);
process.stdout.write(`${output}\n`);
