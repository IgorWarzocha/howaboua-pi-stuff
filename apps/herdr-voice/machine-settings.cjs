// Runs through Core on the selected machine. Never starts Pi or loads extensions.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

async function settings() {
  const request = JSON.parse(process.argv[1]);
  const names = { codex: "@howaboua/pi-codex-conversion", gippity: "@howaboua/pi-gippity-control", grok: "@howaboua/pi-grok-realtime" };
  const name = names[request.provider];
  if (!name) throw new Error("Choose a supported voice extension");
  let sdkRoot;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const executable = path.resolve(dir, process.platform === "win32" ? "pi.cmd" : "pi");
    if (!fs.existsSync(executable)) continue;
    let candidate = path.dirname(fs.realpathSync(executable));
    for (let depth = 0; depth < 5; depth++, candidate = path.dirname(candidate)) {
      const manifest = path.join(candidate, "package.json");
      if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") {
        sdkRoot = candidate;
        break;
      }
    }
    if (sdkRoot) break;
    // npm's Windows command shim sits beside node_modules, not inside the package.
    const installed = path.join(dir, "node_modules", "@earendil-works", "pi-coding-agent");
    if (fs.existsSync(path.join(installed, "package.json"))) { sdkRoot = installed; break; }
  }
  if (!sdkRoot) throw new Error("Install the Node.js distribution of Pi and make its pi executable available on PATH");
  const sdk = await import(pathToFileURL(path.join(sdkRoot, "dist", "index.js")).href);
  const agentDir = sdk.getAgentDir();
  const manager = new sdk.DefaultPackageManager({
    cwd: os.homedir(), agentDir,
    settingsManager: sdk.SettingsManager.create(os.homedir(), agentDir, { projectTrusted: false }),
  });
  const roots = [];
  for (const pkg of manager.listConfiguredPackages()) {
    if (pkg.scope !== "user" || !pkg.installedPath) continue;
    const manifest = path.join(pkg.installedPath, "package.json");
    if (!fs.existsSync(manifest)) continue;
    if (JSON.parse(fs.readFileSync(manifest, "utf8")).name === name) roots.push(fs.realpathSync(pkg.installedPath));
  }
  const unique = [...new Set(roots)];
  if (unique.length !== 1) throw new Error(unique.length ? "Multiple copies of this voice extension are configured; choose one in Pi settings" : "Install and configure " + name + " globally on this machine");
  const packageRoot = unique[0];
  if (request.packageRoot && request.packageRoot !== packageRoot) throw new Error("The voice extension changed; reload settings before saving");
  const entry = path.join(packageRoot, "dist", "host-settings.js");
  if (!fs.existsSync(entry)) throw new Error("Update " + name + " on this machine to edit its settings without starting Pi");
  const runtime = await sdk.ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"), allowModelNetwork: false,
  });
  if (runtime.getError()) throw new Error("Cannot read the host model catalog: " + runtime.getError());
  const models = runtime.getAvailableSnapshot().filter(model => model.input.includes("text"))
    .map(model => ({ provider: model.provider, modelId: model.id }));
  const { hostSettings } = await import(pathToFileURL(entry).href);
  const result = await hostSettings({ agentDir, models,
    ...(request.patch ? { patch: request.patch, identity: request.identity } : {}),
  });
  console.log(JSON.stringify({ ...result, packageRoot }));
}

void settings().catch(error => {
  console.log(JSON.stringify({ herdrVoiceError: error.message }));
  process.exitCode = 1;
});
