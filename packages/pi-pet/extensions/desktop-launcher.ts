import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopConfig } from "../src/desktop/config.ts";
import type { RemoteDesktopConfig } from "./desktop-config.ts";
import { parseSshTarget } from "./desktop-config.ts";

const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const STOP_TIMEOUT_MS = 3_000;
const MAX_SOURCE_BYTES = 512 * 1024;
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REMOTE_SOURCE_PATHS = [
  "desktop/build.mjs",
  "desktop/package-lock.json",
  "desktop/package.json",
  "src/desktop/attention.ts",
  "src/desktop/bridge.ts",
  "src/desktop/config.ts",
  "src/desktop/cursor-provider.ts",
  "src/desktop/main.ts",
  "src/desktop/preload.ts",
] as const;

const LOCAL_HELPER = String.raw`
const { spawn } = require("node:child_process");
const { createReadStream } = require("node:fs");
const target = process.argv[1];
const chunks = [];
let size = 0;
let ssh;
let stopping = false;
const stop = () => { stopping = true; ssh?.kill(); };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, stop);
const owner = createReadStream("", { fd: 3, autoClose: false });
owner.once("end", stop); owner.once("close", stop); owner.once("error", stop); owner.resume();
process.stdin.on("data", chunk => {
  size += chunk.length;
  if (size > 1024 * 1024) { process.stderr.write("Pi Pet bootstrap is too large\n"); process.exit(1); }
  chunks.push(chunk);
});
process.stdin.on("end", () => {
  if (stopping) { process.exit(0); return; }
  ssh = spawn("ssh", [target, "node", "-"], { stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
  ssh.once("error", error => { process.stderr.write(error.message + "\n"); process.exit(1); });
  ssh.once("exit", code => process.exit(stopping ? 0 : (code ?? 1)));
  ssh.stdin.end(Buffer.concat(chunks));
});
`;

const REMOTE_BOOTSTRAP = String.raw`
const { spawn, spawnSync } = require("node:child_process");
const { mkdir, mkdtemp, readdir, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, resolve, sep } = require("node:path");
const { createRequire } = require("node:module");
let activeChild;
let stopping = false;
let ownerMarker;
let markerWrites = Promise.resolve();
let heartbeatCount = 0;
const emit = phase => process.stdout.write(JSON.stringify({ type: "phase", phase }) + "\n");
const bounded = value => value.length <= 8192 ? value : value.slice(value.length - 8192);
function refreshOwnerMarker() {
  if (!ownerMarker) return Promise.resolve();
  markerWrites = markerWrites.catch(() => undefined).then(() => writeFile(
    ownerMarker,
    JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt, heartbeatAt: Date.now() }),
    { mode: 0o600 },
  ));
  return markerWrites;
}
const startedAt = Date.now();
const heartbeat = setInterval(() => {
  process.stdout.write('{"type":"heartbeat"}\n');
  heartbeatCount += 1;
  if (heartbeatCount % 60 === 0) void refreshOwnerMarker().catch(stop);
}, 1000);
const stop = () => { stopping = true; clearInterval(heartbeat); activeChild?.kill(); };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, stop);
process.stdout.once("close", stop);
process.stdout.once("error", stop);
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let errorText = "";
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    activeChild = child;
    child.stderr.on("data", chunk => { errorText = bounded(errorText + chunk.toString("utf8")); });
    child.once("error", reject);
    child.once("exit", code => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(errorText.trim() || command + " exited " + (code ?? "without status")));
    });
  });
}
function graphicalEnvironment() {
  const environment = { ...process.env };
  if (process.platform !== "linux") return environment;
  const result = spawnSync("systemctl", ["--user", "show-environment"], {
    encoding: "utf8", timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  if (result.status !== 0) return environment;
  const allowed = new Set(["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "HYPRLAND_INSTANCE_SIGNATURE"]);
  for (const line of result.stdout.split("\n")) {
    const separator = line.indexOf("=");
    const key = separator < 0 ? "" : line.slice(0, separator);
    if (allowed.has(key)) environment[key] = line.slice(separator + 1);
  }
  return environment;
}
function processIsRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function reapStaleCheckouts() {
  const directory = tmpdir();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!(entry.isDirectory() && entry.name.startsWith("howaboua-pi-pet-"))) continue;
    const path = join(directory, entry.name);
    try {
      const marker = JSON.parse(await readFile(join(path, ".ephemeral-owner.json"), "utf8"));
      if (marker.schemaVersion !== 1 || !Number.isSafeInteger(marker.pid) || !Number.isFinite(marker.heartbeatAt)) continue;
      const staleFor = Date.now() - marker.heartbeatAt;
      if (staleFor < 24 * 60 * 60 * 1000) continue;
      if (staleFor < 7 * 24 * 60 * 60 * 1000 && processIsRunning(marker.pid)) continue;
      await rm(path, { recursive: true, force: true });
    } catch {}
  }
}
async function main() {
  await reapStaleCheckouts();
  if (stopping) return;
  const root = await mkdtemp(join(tmpdir(), "howaboua-pi-pet-"));
  try {
    if (stopping) return;
    ownerMarker = join(root, ".ephemeral-owner.json");
    await refreshOwnerMarker();
    emit("copy");
    const checkout = join(root, "source");
    for (const [relativePath, encoded] of Object.entries(options.files)) {
      const target = resolve(checkout, relativePath);
      if (!target.startsWith(checkout + sep)) throw new Error("Pi Pet source path escaped its temporary checkout");
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, Buffer.from(encoded, "base64"), { mode: 0o600, flag: "wx" });
    }
    if (stopping) return;
    const desktop = join(checkout, "desktop");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    emit("install");
    await run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], desktop);
    if (stopping) return;
    emit("build");
    await run(npm, ["run", "build"], desktop);
    if (stopping) return;
    emit("run");
    const requireFromDesktop = createRequire(join(desktop, "package.json"));
    const electron = requireFromDesktop("electron");
    await new Promise((resolve, reject) => {
      const child = spawn(electron, [join(desktop, "dist", "app")], {
        cwd: desktop,
        env: { ...graphicalEnvironment(), PI_PET_GIPPITY_URL: options.gippityUrl, PI_PET_OWNER_FD: "3" },
        stdio: ["ignore", "inherit", "inherit", "pipe"],
        windowsHide: true,
      });
      activeChild = child;
      child.once("error", reject);
      child.once("exit", code => {
        if (activeChild === child) activeChild = undefined;
        if (code === 0 || stopping) resolve();
        else reject(new Error("Electron exited " + (code ?? "without status")));
      });
    });
  } finally {
    clearInterval(heartbeat);
    await markerWrites.catch(() => undefined);
    ownerMarker = undefined;
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write((error?.message || String(error)) + "\n"); process.exitCode = 1; });
`;

export interface RemoteDesktopProcessSpec {
  program: "node";
  args: ["-e", string, string];
  source: string;
}

function packagedDesktopSource(): Record<string, string> {
  const files: Record<string, string> = {};
  let size = 0;
  for (const path of REMOTE_SOURCE_PATHS) {
    const contents = readFileSync(join(PACKAGE_ROOT, path));
    size += contents.length;
    if (size > MAX_SOURCE_BYTES) throw new Error("Pi Pet desktop source is unexpectedly large.");
    files[path] = contents.toString("base64");
  }
  return files;
}

export function remoteDesktopProcessSpec(target: string, gippityUrl: string): RemoteDesktopProcessSpec {
  const origin = parseDesktopConfig({ schemaVersion: 1, gippityUrl }).gippityUrl;
  const options = { files: packagedDesktopSource(), gippityUrl: origin };
  const sshTarget = parseSshTarget(target);
  return {
    program: "node",
    args: ["-e", LOCAL_HELPER, sshTarget],
    source: `const options = ${JSON.stringify(options)};\n${REMOTE_BOOTSTRAP}`,
  };
}

interface RemoteDesktopCallbacks {
  onExit(target: string, error?: Error): void;
  onPhase(target: string, phase: string): void;
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length <= MAX_DIAGNOSTIC_BYTES ? next : next.slice(next.length - MAX_DIAGNOSTIC_BYTES);
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.kill();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, STOP_TIMEOUT_MS);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

export class RemoteDesktopFleet {
  readonly #callbacks: RemoteDesktopCallbacks;
  readonly #children = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(callbacks: RemoteDesktopCallbacks) {
    this.#callbacks = callbacks;
  }

  targets(): string[] {
    return [...this.#children.keys()].sort();
  }

  async startAll(config: RemoteDesktopConfig): Promise<void> {
    await Promise.all(
      Object.entries(config.displays).map(([target, display]) => this.start(target, display.gippityUrl)),
    );
  }

  async start(target: string, gippityUrl: string): Promise<void> {
    await this.stop(target);
    const spec = remoteDesktopProcessSpec(target, gippityUrl);
    const child = spawn(spec.program, spec.args, {
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#children.set(target, child);
    let diagnostics = "";
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostics = appendBounded(diagnostics, chunk);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      let newline = output.indexOf("\n");
      while (newline >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        try {
          const event = JSON.parse(line) as { type?: unknown; phase?: unknown };
          if (event.type === "phase" && typeof event.phase === "string") this.#callbacks.onPhase(target, event.phase);
        } catch {
          diagnostics = appendBounded(diagnostics, Buffer.from(line));
        }
        newline = output.indexOf("\n");
      }
      if (output.length > MAX_DIAGNOSTIC_BYTES) output = output.slice(-MAX_DIAGNOSTIC_BYTES);
    });
    child.once("error", (error) => this.#finished(target, child, error));
    child.once("exit", (code) => {
      const error =
        code === 0 ? undefined : new Error(diagnostics.trim() || `SSH desktop exited ${code ?? "without status"}`);
      this.#finished(target, child, error);
    });
    child.stdin.end(spec.source);
  }

  async stop(target: string): Promise<void> {
    const child = this.#children.get(target);
    if (!child) return;
    this.#children.delete(target);
    await stopChild(child);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#children.keys()].map((target) => this.stop(target)));
  }

  #finished(target: string, child: ChildProcessWithoutNullStreams, error?: Error): void {
    if (this.#children.get(target) !== child) return;
    this.#children.delete(target);
    this.#callbacks.onExit(target, error);
  }
}
