#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brokerBaseUrl, configPath, createConfig, loadConfig, setNetworkMode } from "../config.ts";
import { PiPetBroker } from "./broker.ts";
import { loadPet } from "./pet-loader.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(): string {
  return `Pi Pet

Usage:
  pi-pet setup        Create role-separated local credentials
  pi-pet serve        Run the loopback broker and web app
  pi-pet display-url  Print the local display URL with its secret fragment
  pi-pet status       Show broker, pet, and display status
  pi-pet network lan|loopback
                      Choose trusted-LAN or loopback-only listening
  pi-pet validate [directory]
                      Validate a pet package without starting the broker
  pi-pet service install|remove
                      Manage the persistent systemd user service
`;
}

async function setup(): Promise<void> {
  const path = configPath();
  const config = await createConfig(path);
  process.stdout.write(`Created ${path}\n`);
  process.stdout.write(`Display URL: ${brokerBaseUrl(config)}/#token=${encodeURIComponent(config.displayToken)}\n`);
  process.stdout.write(
    "The URL fragment contains the display credential; share it only through the SSH-protected path.\n",
  );
}

async function serve(): Promise<void> {
  const config = await loadConfig();
  const petsRoot = join(packageRoot, "pets");
  const loaded = await loadPet(petsRoot, config.activePet);
  const broker = new PiPetBroker({
    config,
    catalog: loaded.catalog,
    petDirectory: loaded.directory,
    reloadPet: async () => await loadPet(petsRoot, config.activePet),
    webRoot: join(packageRoot, "dist", "web"),
  });
  await broker.listen();
  process.stdout.write(`Pi Pet listening on ${broker.address}\n`);
  process.stdout.write(`Active pet: ${loaded.catalog.displayName} (${loaded.catalog.id})\n`);
  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    process.stdout.write(`Pi Pet stopping (${signal})\n`);
    await broker.close();
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
}

async function displayUrl(): Promise<void> {
  const config = await loadConfig();
  process.stdout.write(`${brokerBaseUrl(config)}/#token=${encodeURIComponent(config.displayToken)}\n`);
}

async function status(): Promise<void> {
  const config = await loadConfig();
  const response = await fetch(`${brokerBaseUrl(config)}/api/v1/status`, {
    headers: { authorization: `Bearer ${config.agentToken}` },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Broker status returned HTTP ${response.status}.`);
  process.stdout.write(`${await response.text()}`);
}

async function network(mode?: string): Promise<void> {
  if (mode !== "lan" && mode !== "loopback") throw new Error("Usage: pi-pet network lan|loopback");
  const config = await setNetworkMode(mode);
  const scope = mode === "lan" ? "all interfaces on the trusted LAN" : "loopback only";
  process.stdout.write(`Pi Pet will listen on ${scope} after the broker restarts (${config.host}:${config.port}).\n`);
}

async function validate(directoryArgument?: string): Promise<void> {
  let directory: string;
  if (directoryArgument) directory = resolve(directoryArgument);
  else {
    const config = await loadConfig();
    directory = join(packageRoot, "pets", config.activePet);
  }
  const loaded = await loadPet(dirname(directory), basename(directory));
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        id: loaded.catalog.id,
        displayName: loaded.catalog.displayName,
        actions: Object.keys(loaded.catalog.actions).sort(),
        aliases: loaded.catalog.aliases,
        directionPoses: Object.keys(loaded.catalog.directions).length,
        directory: loaded.directory,
      },
      null,
      2,
    )}\n`,
  );
}

function systemctl(...args: string[]): void {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `systemctl ${args.join(" ")} failed.`);
}

async function service(action?: string): Promise<void> {
  if (process.platform !== "linux")
    throw new Error("The bundled service manager currently supports Linux systemd user services only.");
  const systemdDirectory = join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "systemd", "user");
  const unitPath = join(systemdDirectory, "pi-pet.service");
  if (action === "install") {
    const resolvedConfigPath = configPath();
    await loadConfig(resolvedConfigPath);
    await mkdir(systemdDirectory, { recursive: true });
    const executable = join(packageRoot, "dist", "pi-pet.mjs");
    const unit = `[Unit]\nDescription=Pi Pet broker and web companion\nAfter=network.target\n\n[Service]\nType=simple\nEnvironment=${JSON.stringify(`PI_PET_CONFIG=${resolvedConfigPath}`)}\nExecStart=${JSON.stringify(executable)} serve\nRestart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\n\n[Install]\nWantedBy=default.target\n`;
    try {
      await writeFile(unitPath, unit, { flag: "wx", mode: 0o644 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Service already exists: ${unitPath}`);
      throw error;
    }
    systemctl("daemon-reload");
    try {
      systemctl("enable", "--now", "pi-pet.service");
    } catch (error) {
      await unlink(unitPath).catch(() => undefined);
      systemctl("daemon-reload");
      throw error;
    }
    process.stdout.write(`Installed and started ${unitPath}\n`);
    return;
  }
  if (action === "remove") {
    systemctl("disable", "--now", "pi-pet.service");
    await unlink(unitPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    systemctl("daemon-reload");
    process.stdout.write(`Removed ${unitPath}\n`);
    return;
  }
  throw new Error("Usage: pi-pet service install|remove");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  const argument = process.argv[3];
  if (process.argv.length > 4) throw new Error(`Unexpected argument: ${process.argv[4]}`);
  if (command !== "validate" && command !== "service" && command !== "network" && argument) {
    throw new Error(`Unexpected argument: ${argument}`);
  }
  if (command === "setup") return await setup();
  if (command === "serve") return await serve();
  if (command === "display-url") return await displayUrl();
  if (command === "status") return await status();
  if (command === "network") return await network(argument);
  if (command === "validate") return await validate(argument);
  if (command === "service") return await service(argument);
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
