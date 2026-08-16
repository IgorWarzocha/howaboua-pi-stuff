import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "bun";
import { writePetDistribution } from "../src/authoring/pet-distribution.ts";
import { loadPet } from "../src/pet-loader.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const loaded = await loadPet(join(root, "pets"), "clawa");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "web"), { recursive: true });
await mkdir(join(dist, "desktop"), { recursive: true });
await mkdir(join(dist, "authoring"), { recursive: true });

const results = await Promise.all([
  build({
    entrypoints: [join(root, "src/web/main.ts")],
    outdir: join(dist, "web"),
    naming: "app.js",
    target: "browser",
    format: "esm",
    minify: true,
  }),
  build({
    entrypoints: [join(root, "src/desktop/main.ts")],
    outdir: join(dist, "desktop"),
    naming: "main.mjs",
    target: "node",
    format: "esm",
    external: ["electron"],
    minify: true,
  }),
  build({
    entrypoints: [join(root, "src/desktop/preload.ts")],
    outdir: join(dist, "desktop"),
    naming: "preload.cjs",
    target: "node",
    format: "cjs",
    external: ["electron"],
    minify: true,
  }),
  build({
    entrypoints: [join(root, "src/authoring/rebuild-cli.ts")],
    outdir: join(dist, "authoring"),
    naming: "rebuild.mjs",
    target: "node",
    format: "esm",
    minify: true,
  }),
  build({
    entrypoints: [join(root, "src/authoring/validate-cli.ts")],
    outdir: join(dist, "authoring"),
    naming: "validate.mjs",
    target: "node",
    format: "esm",
    minify: true,
  }),
]);

for (const result of results) {
  for (const log of result.logs) process.stderr.write(`${log}\n`);
  if (!result.success) throw new Error("Bun failed to build Pi Pet.");
}

for (const file of ["index.html", "styles.css", "manifest.webmanifest", "pet-icon.svg"]) {
  await cp(join(root, "src", "web", file), join(dist, "web", file));
}
await writePetDistribution(root, loaded);
