// Runs through Core on the selected machine. Pi owns its SDK and package layout.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

function discover() {
  if (!process.argv[2]) throw new Error("The host settings helper is missing; reinstall Herdr Voice");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-voice-settings-"));
  try {
    fs.chmodSync(directory, 0o700);
    const responsePath = path.join(directory, "response.json");
    fs.writeFileSync(path.join(directory, "host-settings.ts"), process.argv[2], { mode: 0o600 });
    const child = spawnSync("pi", [
      "--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-tools",
      "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      "--no-approve", "--print", "-e", "./host-settings.ts",
    ], {
      cwd: directory, input: "", encoding: "utf8", timeout: 8000, windowsHide: true,
      // Only fixed arguments reach cmd.exe, which also supports npm's pi.cmd on PATH.
      shell: process.platform === "win32",
      env: { ...process.env, HERDR_VOICE_SETTINGS_RESPONSE: responsePath },
    });
    // The extension completes before Pi checks model availability. Its receipt,
    // not Pi's later exit status or stdout, determines whether discovery succeeded.
    if (!fs.existsSync(responsePath)) {
      if (child.error?.code === "ENOENT") throw new Error("Cannot run pi on the selected machine; make pi available on its PATH");
      throw new Error("Pi did not confirm the host settings operation; reload settings before retrying");
    }
    const response = JSON.parse(fs.readFileSync(responsePath, "utf8"));
    if (response.error) throw new Error(response.error);
    const discovery = response.discovery;
    if (!discovery || typeof discovery.agentDir !== "string" || !path.isAbsolute(discovery.agentDir)
      || !Array.isArray(discovery.models) || !Array.isArray(discovery.packageRoots)
      || !discovery.packageRoots.every(root => typeof root === "string" && path.isAbsolute(root))) {
      throw new Error("Pi returned incomplete settings information; update Pi and reload settings");
    }
    return discovery;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function settings() {
  const request = JSON.parse(process.argv[1]);
  const names = { codex: "@howaboua/pi-codex-conversion", gippity: "@howaboua/pi-gippity-control", grok: "@howaboua/pi-grok-realtime" };
  const name = Object.hasOwn(names, request.provider) ? names[request.provider] : undefined;
  if (!name) throw new Error("Choose a supported voice extension");
  const { agentDir, models, packageRoots } = discover();
  const roots = new Set();
  for (const root of packageRoots) {
    const manifest = path.join(root, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const installed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (installed.name === name) roots.add(fs.realpathSync(root));
    else if (["@howaboua/pi-stuff", "@howaboua/pi-extensions"].includes(installed.name) && installed.dependencies?.[name]) {
      // Resolve our exported dist/host-settings.js in Node, without importing an
      // extension entry point or relying on a standalone Pi's package resolver.
      let entry;
      try { entry = createRequire(manifest).resolve(name + "/host-settings"); }
      catch { throw new Error("Update " + installed.name + " on this machine; its " + name + " host settings are unavailable"); }
      roots.add(path.dirname(path.dirname(fs.realpathSync(entry))));
    }
  }
  if (roots.size !== 1) throw new Error(roots.size ? "Multiple copies of this voice extension are configured; choose one in Pi settings" : "Install and configure " + name + " globally on this machine");
  const packageRoot = [...roots][0];
  if (request.packageRoot && request.packageRoot !== packageRoot) throw new Error("The voice extension changed; reload settings before saving");
  const entry = path.join(packageRoot, "dist", "host-settings.js");
  if (!fs.existsSync(entry)) throw new Error("Update " + name + " on this machine to edit its host settings");
  const { hostSettings } = await import(pathToFileURL(entry).href);
  if (typeof hostSettings !== "function") throw new Error("Update " + name + " on this machine to edit its host settings");
  const result = await hostSettings({ agentDir, models,
    ...(request.patch ? { patch: request.patch, identity: request.identity } : {}),
  });
  console.log(JSON.stringify({ ...result, packageRoot }));
}

void settings().catch(error => {
  console.log(JSON.stringify({ herdrVoiceError: error.message }));
  process.exitCode = 1;
});
