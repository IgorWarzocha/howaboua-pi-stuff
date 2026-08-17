import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { parseDesktopConfig, parseDeviceName, parseSshTarget } from "../src/desktop/config.ts";
import { type RepositoryPetConfig, readRepositoryPetConfig, writeRepositoryPetConfig } from "../src/pet-storage.ts";
import {
  type DeviceRegistryConfig,
  type PetDevice,
  readDeviceRegistry,
  writeDeviceRegistry,
} from "./desktop-config.ts";
import { DesktopDeviceFleet } from "./desktop-launcher.ts";
import { GippityUnavailableError, isMissingGippity } from "./gippity.ts";

const ACTIONS = ["attach", "detach", "restart", "status"] as const;
const ARGUMENT_SEPARATOR = /\s+/;
const MAX_AUTHORING_REQUEST_BYTES = 8 * 1024;
const AUTHORING_GUIDE = fileURLToPath(new URL("../authoring/PET-GUIDE.md", import.meta.url));

type PetCommand =
  | { action: "attach"; device: string; gippityUrl?: string | undefined }
  | { action: "detach"; device: string }
  | { action: "restart" }
  | { action: "status" }
  | { action: "author"; request: string };

function usage(): string {
  return "Usage: /pet attach <local|device> [gippity-url] | detach <device> | restart | status";
}

function projectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "pi-pet.json");
}

function selectedDeviceNames(registry: DeviceRegistryConfig, project: RepositoryPetConfig | undefined): string[] {
  const names = project?.devices ?? registry.defaultDevices;
  const missing = names.find((name) => !Object.hasOwn(registry.devices, name));
  if (missing) throw new Error(`Pi Pet device is selected but not registered: ${missing}.`);
  return names;
}

function formatStatus(names: string[], fleet: DesktopDeviceFleet): string {
  const running = new Set(fleet.deviceNames());
  if (names.length === 0) return "Pi Pet is active with no devices attached for this folder.";
  return [...names]
    .sort()
    .map((name) => `${name}: ${running.has(name) ? "running" : "stopped"}`)
    .join("\n");
}

function authoringCommand(request: string): PetCommand {
  if (Buffer.byteLength(request) > MAX_AUTHORING_REQUEST_BYTES) {
    throw new Error(`Pi Pet authoring request exceeds ${MAX_AUTHORING_REQUEST_BYTES} bytes.`);
  }
  return { action: "author", request };
}

function parsePetCommand(rawArgs: string): PetCommand {
  const request = rawArgs.trim();
  const tokens = request ? request.split(ARGUMENT_SEPARATOR) : ["status"];
  const [rawAction, rawDevice, rawUrl, ...extra] = tokens;
  const action = rawAction?.toLowerCase();
  if (!(action && ACTIONS.includes(action as (typeof ACTIONS)[number]))) {
    return authoringCommand(request);
  }
  if (extra.length > 0) throw new Error(usage());
  const validAction = action as (typeof ACTIONS)[number];
  if (validAction === "status" || validAction === "restart") {
    if (rawDevice || rawUrl) throw new Error(usage());
    return { action: validAction };
  }
  if (!rawDevice) throw new Error(usage());
  const device = parseDeviceName(rawDevice);
  if (validAction === "detach") {
    if (rawUrl) throw new Error(usage());
    return { action: validAction, device };
  }
  const gippityUrl = rawUrl ? parseDesktopConfig({ schemaVersion: 1, gippityUrl: rawUrl }).gippityUrl : undefined;
  return { action: "attach", device, ...(gippityUrl ? { gippityUrl } : {}) };
}

function petAuthoringPrompt(request: string): string {
  return `Read and follow the Pi Pet guide at ${JSON.stringify(AUTHORING_GUIDE)} for this request:\n\n${request}`;
}

function deviceForAttach(name: string, existing: PetDevice | undefined, gippityUrl?: string): PetDevice {
  if (name === "local") {
    if (existing?.kind === "ssh") throw new Error("The reserved local device cannot be an SSH device.");
    const url = gippityUrl ?? existing?.gippityUrl;
    return { kind: "local", ...(url ? { gippityUrl: url } : {}) };
  }
  if (existing) {
    const url = gippityUrl ?? existing.gippityUrl;
    return { ...existing, ...(url ? { gippityUrl: url } : {}) };
  }
  return {
    kind: "ssh",
    target: parseSshTarget(name),
    ...(gippityUrl ? { gippityUrl } : {}),
  };
}

async function startDevices(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  fleet: DesktopDeviceFleet,
  registry: DeviceRegistryConfig,
  names: string[],
): Promise<string> {
  let status: { running: boolean; urls: string[] };
  try {
    const { ensureGippityLan } = await import("@howaboua/pi-gippity-control/lan-service");
    status = await ensureGippityLan(pi, ctx);
  } catch (error) {
    if (isMissingGippity(error)) throw new GippityUnavailableError();
    throw error;
  }
  const automaticUrl = parseDesktopConfig({ schemaVersion: 1, gippityUrl: status.urls[0] }).gippityUrl;
  await Promise.all(names.map((name) => fleet.start(name, registry.devices[name] as PetDevice, automaticUrl)));
  return automaticUrl;
}

async function executeCommand(
  pi: ExtensionAPI,
  command: PetCommand,
  fleet: DesktopDeviceFleet,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (command.action === "author") {
    await access(AUTHORING_GUIDE);
    await ctx.waitForIdle();
    pi.sendUserMessage(petAuthoringPrompt(command.request));
    return;
  }
  const path = projectConfigPath(ctx.cwd);
  const registry = await readDeviceRegistry();
  const project = readRepositoryPetConfig(path);
  const selected = selectedDeviceNames(registry, project);
  if (command.action === "status") {
    ctx.ui.notify(formatStatus(selected, fleet), "info");
    return;
  }
  if (command.action === "restart") {
    await fleet.stopAll();
    if (selected.length > 0) await startDevices(pi, ctx, fleet, registry, selected);
    ctx.ui.notify("Pi Pet devices for this folder restarted.", "info");
    return;
  }
  if (command.action === "detach") {
    const devices = selected.filter((name) => name !== command.device);
    await writeRepositoryPetConfig({ ...project, schemaVersion: 1, devices }, path);
    await fleet.stop(command.device);
    ctx.ui.notify(`Pi Pet device ${command.device} detached from this folder.`, "info");
    return;
  }
  const device = deviceForAttach(command.device, registry.devices[command.device], command.gippityUrl);
  const nextRegistry: DeviceRegistryConfig = {
    ...registry,
    devices: { ...registry.devices, [command.device]: device },
  };
  const automaticUrl = await startDevices(pi, ctx, fleet, nextRegistry, [command.device]);
  try {
    await writeDeviceRegistry(nextRegistry);
    await writeRepositoryPetConfig(
      {
        ...project,
        schemaVersion: 1,
        devices: [...new Set([...selected, command.device])],
      },
      path,
    );
  } catch (error) {
    await fleet.stop(command.device);
    throw error;
  }
  ctx.ui.notify(
    `Pi Pet device ${command.device} attached to this folder through ${command.gippityUrl ?? automaticUrl}.`,
    "info",
  );
}

export function registerPetDevices(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  const phases = new Map<string, string>();
  const fleet = new DesktopDeviceFleet({
    onPhase(device, phase) {
      phases.set(device, phase);
      context?.ui.setStatus("pi-pet-device", `Pi Pet ${device}: ${phase}`);
    },
    onExit(device, error) {
      phases.delete(device);
      if (phases.size === 0) context?.ui.setStatus("pi-pet-device", undefined);
      if (error && context?.hasUI) context.ui.notify(`Pi Pet device ${device}: ${error.message}`, "warning");
    },
  });

  pi.registerCommand("pet", {
    description: "Control devices or start Pi Pet authoring",
    getArgumentCompletions: (prefix) =>
      ACTIONS.filter((action) => action.startsWith(prefix.trim().toLowerCase())).map((value) => ({
        label: value,
        value,
      })),
    handler: async (rawArgs, ctx) => {
      try {
        await executeCommand(pi, parsePetCommand(rawArgs), fleet, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    try {
      const registry = await readDeviceRegistry();
      const project = readRepositoryPetConfig(projectConfigPath(ctx.cwd));
      const selected = selectedDeviceNames(registry, project);
      if (selected.length > 0) await startDevices(pi, ctx, fleet, registry, selected);
    } catch (error) {
      if (!(error instanceof GippityUnavailableError)) {
        ctx.ui.notify(
          `Pi Pet devices could not start: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });
  pi.on("session_shutdown", async () => {
    context = undefined;
    phases.clear();
    await fleet.stopAll();
  });
}
