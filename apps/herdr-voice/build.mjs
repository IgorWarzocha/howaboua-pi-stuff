#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
const platforms = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-pc-windows-msvc": "win32-x64",
  "aarch64-pc-windows-msvc": "win32-arm64",
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr ?? ""}`);
  return result.stdout;
}
const triple = target ?? run("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
const platform = platforms[triple];
if (!platform) throw new Error(`No audio bundle for ${triple}`);
const suffix = platform.startsWith("win32") ? ".exe" : "";
const helper = join(root, "../../packages/pi-grok-realtime/src/audio/bin", platform);
// Release the owning audio build unchanged, including its licence notices.
readFileSync(join(helper, `grok-audio${suffix}`));
readFileSync(join(helper, "LICENSES.txt"));
run("cargo", ["build", "--release", "--locked", ...(target ? ["--target", target] : [])], { stdio: "inherit" });
const destination = join(root, "dist", `herdr-voice-${platform}`);
mkdirSync(destination, { recursive: true });
for (const [source, name] of [
  [join(root, "target", ...(target ? [target] : []), "release", `herdr-voice${suffix}`), `herdr-voice${suffix}`],
  [join(helper, `grok-audio${suffix}`), `grok-audio${suffix}`],
  [join(helper, "LICENSES.txt"), "AUDIO-LICENSES.txt"],
  [join(root, "../../LICENSE"), "LICENSE"],
  [join(root, "README.md"), "README.md"],
  [join(root, "pi-bridge.ts"), "pi-bridge.ts"],
]) copyFileSync(source, join(destination, name));
if (!suffix) for (const name of ["herdr-voice", "grok-audio"]) chmodSync(join(destination, name), 0o755);
console.log(destination);
