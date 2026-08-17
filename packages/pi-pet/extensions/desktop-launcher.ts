import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopConfig } from "../src/desktop/config.ts";
import { parseSshTarget } from "./desktop-config.ts";

const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const STOP_TIMEOUT_MS = 3_000;
const MAX_SOURCE_BYTES = 512 * 1024;
const SSH_SOURCE_CHUNK_BYTES = 4 * 1024;
const SSH_SOURCE_CHUNK_DELAY_MS = 10;
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

const REMOTE_BOOTSTRAP = String.raw`
const { spawn, spawnSync } = require("node:child_process");
const { access, mkdir, readFile, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { isIP } = require("node:net");
const { dirname, join, resolve, sep } = require("node:path");
const { createRequire } = require("node:module");
let activeChild;
let stopping = false;
let stopTimer;
const ownerPid = process.ppid;
const emit = phase => process.stdout.write(JSON.stringify({ type: "phase", phase }) + "\n");
const bounded = value => value.length <= 8192 ? value : value.slice(value.length - 8192);
const ownerIsRunning = () => { try { process.kill(ownerPid, 0); return true; } catch { return false; } };
const heartbeat = setInterval(() => {
  if (!ownerIsRunning()) { stop(); return; }
  process.stdout.write('{"type":"heartbeat"}\n');
}, 1000);
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  activeChild?.kill();
  stopTimer = setTimeout(() => { activeChild?.kill("SIGKILL"); process.exit(0); }, 3000);
};
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
function displayGippityUrl() {
  if (!options.useSshSourceAddress) return options.gippityUrl;
  const sourceAddress = process.env.SSH_CONNECTION?.trim().split(/\s+/)[0];
  if (!sourceAddress || !isIP(sourceAddress)) return options.gippityUrl;
  const url = new URL(options.gippityUrl);
  url.hostname = sourceAddress;
  return url.origin;
}
async function buildIsCurrent(marker, desktop) {
  try {
    const built = JSON.parse(await readFile(marker, "utf8"));
    for (const path of [
      "attention.js", "bridge.cjs", "bridge.js", "config.js", "cursor-provider.js", "main.js", "package.json", "preload.cjs",
    ]) await access(join(desktop, "dist", "app", path));
    const requireFromDesktop = createRequire(join(desktop, "package.json"));
    await access(requireFromDesktop("electron"));
    return built.schemaVersion === 1
      && built.packageVersion === options.packageVersion
      && built.sourceDigest === options.sourceDigest;
  } catch {
    return false;
  }
}
async function main() {
  const root = join(homedir(), ".pi", "agent", "pi-pet");
  const desktop = join(root, "desktop");
  const marker = join(root, ".build.json");
  await mkdir(root, { recursive: true, mode: 0o700 });
  emit("check");
  if (!(await buildIsCurrent(marker, desktop))) {
    if (stopping) return;
    emit("copy");
    for (const [relativePath, encoded] of Object.entries(options.files)) {
      const target = resolve(root, relativePath);
      if (!target.startsWith(root + sep)) throw new Error("Pi Pet source path escaped its application directory");
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, Buffer.from(encoded, "base64"), { mode: 0o600 });
    }
    if (stopping) return;
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    emit("install");
    await run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], desktop);
    if (stopping) return;
    emit("build");
    await run(npm, ["run", "build"], desktop);
    if (stopping) return;
    await writeFile(marker, JSON.stringify({
      schemaVersion: 1,
      packageVersion: options.packageVersion,
      sourceDigest: options.sourceDigest,
    }) + "\n", { mode: 0o600 });
  }
  if (stopping) return;
  emit("run");
  const requireFromDesktop = createRequire(join(desktop, "package.json"));
  const electron = requireFromDesktop("electron");
  await new Promise((resolve, reject) => {
    const child = spawn(electron, [join(desktop, "dist", "app")], {
      cwd: desktop,
      env: { ...graphicalEnvironment(), PI_PET_GIPPITY_URL: displayGippityUrl(), PI_PET_OWNER_FD: "3" },
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
}
main()
  .catch(error => { process.stderr.write((error?.message || String(error)) + "\n"); process.exitCode = 1; })
  .finally(() => { clearInterval(heartbeat); clearTimeout(stopTimer); });
`;

export interface RemoteDesktopProcessSpec {
  program: "ssh";
  args: [string, "node", "-"];
  source: string;
}

function packagedDesktopSource(): { files: Record<string, string>; packageVersion: string; sourceDigest: string } {
  const files: Record<string, string> = {};
  const digest = createHash("sha256");
  let size = 0;
  for (const path of REMOTE_SOURCE_PATHS) {
    const contents = readFileSync(join(PACKAGE_ROOT, path));
    size += contents.length;
    if (size > MAX_SOURCE_BYTES) throw new Error("Pi Pet desktop source is unexpectedly large.");
    files[path] = contents.toString("base64");
    digest.update(path).update("\0").update(contents).update("\0");
  }
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("Pi Pet package version is missing.");
  return { files, packageVersion: manifest.version, sourceDigest: digest.digest("hex") };
}

export function remoteDesktopProcessSpec(
  target: string,
  gippityUrl: string,
  useSshSourceAddress = false,
): RemoteDesktopProcessSpec {
  const origin = parseDesktopConfig({ schemaVersion: 1, gippityUrl }).gippityUrl;
  const options = { ...packagedDesktopSource(), gippityUrl: origin, useSshSourceAddress };
  const sshTarget = parseSshTarget(target);
  return {
    program: "ssh",
    args: [sshTarget, "node", "-"],
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

function sendSource(child: ChildProcessWithoutNullStreams, source: string): void {
  const payload = Buffer.from(source);
  let offset = 0;
  const sendNext = () => {
    if (!child.stdin.writable) return;
    if (offset >= payload.length) {
      child.stdin.end();
      return;
    }
    const nextOffset = Math.min(offset + SSH_SOURCE_CHUNK_BYTES, payload.length);
    const ready = child.stdin.write(payload.subarray(offset, nextOffset));
    offset = nextOffset;
    const resume = () => setTimeout(sendNext, SSH_SOURCE_CHUNK_DELAY_MS);
    if (ready) resume();
    else child.stdin.once("drain", resume);
  };
  sendNext();
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

  async start(target: string, gippityUrl: string, useSshSourceAddress = false): Promise<void> {
    await this.stop(target);
    const spec = remoteDesktopProcessSpec(target, gippityUrl, useSshSourceAddress);
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
    child.once("spawn", () => sendSource(child, spec.source));
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
