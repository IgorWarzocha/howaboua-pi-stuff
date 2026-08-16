import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseDesktopConfig } from "../src/desktop/config.ts";
import {
  parseSshTarget,
  type RemoteDesktopConfig,
  readRemoteDesktopConfig,
  writeRemoteDesktopConfig,
} from "./desktop-config.ts";
import { RemoteDesktopFleet } from "./desktop-launcher.ts";

const ACTIONS = ["attach", "detach", "restart", "status"] as const;
const ARGUMENT_SEPARATOR = /\s+/;

type PetCommand =
  | { action: "attach"; target: string; gippityUrl: string }
  | { action: "detach"; target: string }
  | { action: "restart" }
  | { action: "status" };

function usage(): string {
  return "Usage: /pet attach <ssh-host> <gippity-url> | detach <ssh-host> | restart | status";
}

function formatStatus(config: RemoteDesktopConfig, fleet: RemoteDesktopFleet): string {
  const targets = Object.keys(config.displays).sort();
  const running = new Set(fleet.targets());
  if (targets.length === 0) return "Pi Pet has no attached SSH displays.";
  return targets.map((target) => `${target}: ${running.has(target) ? "running" : "stopped"}`).join("\n");
}

function parseCommand(rawArgs: string): PetCommand {
  const tokens = rawArgs.trim() ? rawArgs.trim().split(ARGUMENT_SEPARATOR) : ["status"];
  const [rawAction, rawTarget, rawUrl, ...extra] = tokens;
  const action = rawAction?.toLowerCase();
  if (!(action && ACTIONS.includes(action as (typeof ACTIONS)[number]) && extra.length === 0)) {
    throw new Error(usage());
  }
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
  if (!rawUrl) throw new Error(usage());
  const { gippityUrl } = parseDesktopConfig({ schemaVersion: 1, gippityUrl: rawUrl });
  return { action: "attach", target, gippityUrl };
}

async function executeCommand(command: PetCommand, fleet: RemoteDesktopFleet, ctx: ExtensionContext): Promise<void> {
  const config = await readRemoteDesktopConfig();
  if (command.action === "status") {
    ctx.ui.notify(formatStatus(config, fleet), "info");
    return;
  }
  if (command.action === "restart") {
    await fleet.stopAll();
    await fleet.startAll(config);
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
  config.displays[command.target] = { gippityUrl: command.gippityUrl };
  await writeRemoteDesktopConfig(config);
  await fleet.start(command.target, command.gippityUrl);
  ctx.ui.notify(`Pi Pet display ${command.target} attached to this Pi instance.`, "info");
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
    description: "Attach Pi Pet displays over SSH",
    getArgumentCompletions: (prefix) =>
      ACTIONS.filter((action) => action.startsWith(prefix.trim().toLowerCase())).map((value) => ({
        label: value,
        value,
      })),
    handler: async (rawArgs, ctx) => {
      try {
        await executeCommand(parseCommand(rawArgs), fleet, ctx);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    try {
      await fleet.startAll(await readRemoteDesktopConfig());
    } catch (error) {
      ctx.ui.notify(
        `Pi Pet displays could not start: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });
  pi.on("session_shutdown", async () => {
    context = undefined;
    phases.clear();
    await fleet.stopAll();
  });
}
