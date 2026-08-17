import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseDesktopConfig } from "../src/desktop/config.ts";
import {
  parseSshTarget,
  type RemoteDesktopConfig,
  readRemoteDesktopConfig,
  writeRemoteDesktopConfig,
} from "./desktop-config.ts";
import { RemoteDesktopFleet } from "./desktop-launcher.ts";
import { GippityUnavailableError, isMissingGippity } from "./gippity.ts";

const ACTIONS = ["attach", "detach", "restart", "status"] as const;
const ARGUMENT_SEPARATOR = /\s+/;
const MAX_AUTHORING_REQUEST_BYTES = 8 * 1024;
const AUTHORING_GUIDE = fileURLToPath(new URL("../authoring/PET-GUIDE.md", import.meta.url));

type PetCommand =
  | { action: "attach"; target: string; gippityUrl?: string | undefined }
  | { action: "detach"; target: string }
  | { action: "restart" }
  | { action: "status" }
  | { action: "author"; request: string };

function usage(): string {
  return "Usage: /pet attach <ssh-host> [gippity-url] | detach <ssh-host> | restart | status";
}

function formatStatus(config: RemoteDesktopConfig, fleet: RemoteDesktopFleet): string {
  const targets = Object.keys(config.displays).sort();
  const running = new Set(fleet.targets());
  if (targets.length === 0) return "Pi Pet feed is active with no attached Electron displays.";
  return targets.map((target) => `${target}: ${running.has(target) ? "running" : "stopped"}`).join("\n");
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
  const [rawAction, rawTarget, rawUrl, ...extra] = tokens;
  const action = rawAction?.toLowerCase();
  if (!(action && ACTIONS.includes(action as (typeof ACTIONS)[number]))) {
    return authoringCommand(request);
  }
  if (extra.length > 0) throw new Error(usage());
  const validAction = action as (typeof ACTIONS)[number];
  if (validAction === "status" || validAction === "restart") {
    if (rawTarget || rawUrl) throw new Error(usage());
    return { action: validAction };
  }
  if (!rawTarget) throw new Error(usage());
  const target = parseSshTarget(rawTarget);
  if (validAction === "detach") {
    if (rawUrl) throw new Error(usage());
    return { action: validAction, target };
  }
  const gippityUrl = rawUrl ? parseDesktopConfig({ schemaVersion: 1, gippityUrl: rawUrl }).gippityUrl : undefined;
  return { action: "attach", target, ...(gippityUrl ? { gippityUrl } : {}) };
}

function petAuthoringPrompt(request: string): string {
  return `Read and follow the Pi Pet guide at ${JSON.stringify(AUTHORING_GUIDE)} for this request:\n\n${request}`;
}

async function startDisplays(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  fleet: RemoteDesktopFleet,
  config: RemoteDesktopConfig,
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
  await Promise.all(
    Object.entries(config.displays).map(([target, display]) =>
      fleet.start(target, display.gippityUrl ?? automaticUrl, !display.gippityUrl),
    ),
  );
  return automaticUrl;
}

async function executeCommand(
  pi: ExtensionAPI,
  command: PetCommand,
  fleet: RemoteDesktopFleet,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (command.action === "author") {
    await access(AUTHORING_GUIDE);
    await ctx.waitForIdle();
    pi.sendUserMessage(petAuthoringPrompt(command.request));
    return;
  }
  const config = await readRemoteDesktopConfig();
  if (command.action === "status") {
    ctx.ui.notify(formatStatus(config, fleet), "info");
    return;
  }
  if (command.action === "restart") {
    await fleet.stopAll();
    if (Object.keys(config.displays).length > 0) await startDisplays(pi, ctx, fleet, config);
    ctx.ui.notify("Pi Pet SSH displays restarted.", "info");
    return;
  }
  if (command.action === "detach") {
    delete config.displays[command.target];
    await writeRemoteDesktopConfig(config);
    await fleet.stop(command.target);
    ctx.ui.notify(`Pi Pet display ${command.target} detached.`, "info");
    return;
  }
  const automaticUrl = await startDisplays(pi, ctx, fleet, {
    schemaVersion: 1,
    displays: { [command.target]: command.gippityUrl ? { gippityUrl: command.gippityUrl } : {} },
  });
  config.displays[command.target] = command.gippityUrl ? { gippityUrl: command.gippityUrl } : {};
  try {
    await writeRemoteDesktopConfig(config);
  } catch (error) {
    await fleet.stop(command.target);
    throw error;
  }
  ctx.ui.notify(`Pi Pet display ${command.target} attached to ${command.gippityUrl ?? automaticUrl}.`, "info");
}

export function registerRemoteDesktops(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  const phases = new Map<string, string>();
  const fleet = new RemoteDesktopFleet({
    onPhase(target, phase) {
      phases.set(target, phase);
      context?.ui.setStatus("pi-pet-desktop", `Pi Pet ${target}: ${phase}`);
    },
    onExit(target, error) {
      phases.delete(target);
      if (phases.size === 0) context?.ui.setStatus("pi-pet-desktop", undefined);
      if (error && context?.hasUI) context.ui.notify(`Pi Pet display ${target}: ${error.message}`, "warning");
    },
  });

  pi.registerCommand("pet", {
    description: "Control displays or start Pi Pet authoring",
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
      const config = await readRemoteDesktopConfig();
      if (Object.keys(config.displays).length > 0) await startDisplays(pi, ctx, fleet, config);
    } catch (error) {
      if (!(error instanceof GippityUnavailableError)) {
        ctx.ui.notify(
          `Pi Pet displays could not start: ${error instanceof Error ? error.message : String(error)}`,
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
