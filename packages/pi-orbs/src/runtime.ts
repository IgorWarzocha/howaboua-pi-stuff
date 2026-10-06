import { access, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
	createHttpHooks,
	VM,
	type VMOptions,
	VmCheckpoint,
} from "@earendil-works/gondolin";
import { type Action, type OrbRecord, profiles } from "./contracts.ts";
import {
	checked,
	execute,
	serviceRoot,
	serviceRunning,
	startService,
	stopService,
} from "./guest.ts";
import { openPortal, openTerminal } from "./portals.ts";
import { existsError, shellQuote as q, saveJson } from "./storage.ts";

export class OrbRuntime {
	private vm: VM | undefined;
	private portals = new Map<string, Awaited<ReturnType<typeof openPortal>>>();
	private healthBase: string | undefined;
	private startupError: string | undefined;
	private recovery: string | undefined;
	private terminal:
		| { user: string; command: string; close(): Promise<void> }
		| undefined;
	private state:
		| "starting"
		| "running"
		| "stopping"
		| "stopped"
		| "prepared"
		| "interrupted"
		| "failed" = "starting";
	private dir: string;
	private record: OrbRecord;
	constructor(dir: string, record: OrbRecord) {
		this.dir = dir;
		this.record = record;
	}
	async boot(prepare: boolean, fresh: boolean): Promise<void> {
		const config = this.record.config;
		const resources = config.resources ?? profiles[config.profile];
		const options: VMOptions = {
			cpus: resources.cpus,
			memory: `${resources.memoryGiB}G`,
			tmpfs: {},
			rootfs: { mode: "cow", size: `${config.diskGiB}G` },
			sessionLabel: `pi-orbs:${this.record.name}`,
			sandbox: {
				vmm: "qemu",
				accel: process.platform === "darwin" ? "hvf" : "kvm",
				...(config.image ? { imagePath: config.image } : {}),
			},
			httpHooks: createHttpHooks({ allowedHosts: config.network.allowedHosts })
				.httpHooks,
			env: {
				HOME: "/root",
				PATH: "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
			},
		};
		const disk = join(this.dir, "disk.qcow2");
		let resume = false;
		try {
			await access(disk);
			resume = true;
		} catch (error) {
			if (!existsError(error, "ENOENT")) throw error;
		}
		const vm: VM = resume
			? await (await VmCheckpoint.load(disk)).resume(options)
			: await VM.create(options);
		this.vm = vm;
		await vm.start();
		// Disabling scratch tmpfs preserves HOME on disk. OCI images still need
		// normal Unix temporary-directory permissions for unprivileged tools.
		await checked(vm, "mkdir -p /tmp /var/tmp; chmod 1777 /tmp /var/tmp");
		await checked(vm, `mkdir -p ${q(config.workspace)}`);
		// A checkpoint restores filesystem files, not processes. Old service pid
		// files must never be mistaken for newly booted unrelated processes.
		await checked(vm, `rm -f ${serviceRoot}/*.pid`);
		if (fresh || !resume) {
			for (const cmd of config.setup)
				await checked(vm, cmd, config.workspace, 120000);
			await saveJson(join(this.dir, "intent.json"), { prepare, fresh: false });
		}
		if (prepare) {
			await this.stop(true);
			return;
		}
		for (const cmd of config.resume)
			await checked(vm, cmd, config.workspace, 120000);
		await this.routes();
		this.state = "running";
		await this.persistStatus();
		try {
			await this.services("ensure");
		} catch (error) {
			this.startupError =
				error instanceof Error
					? error.message
					: "Service readiness failed. Read service logs";
			console.error(error);
		}
		await this.persistStatus();
	}
	private async routes(): Promise<void> {
		const vm = this.requireVm();
		const entries = Object.entries(this.record.config.services);
		if (!entries.length) return;
		vm.setIngressRoutes(
			entries.map(([name, service]) => ({
				prefix: `/${name}/`,
				port: service.port,
				stripPrefix: true,
			})),
		);
		const ingress = await vm.enableIngress({
			listenHost: "127.0.0.1",
			listenPort: 0,
		});
		this.healthBase = ingress.url;
		for (const [name, service] of entries)
			if (service.portal)
				this.portals.set(
					name,
					await openPortal(new URL(ingress.url), `/${name}`),
				);
	}
	private requireVm(): VM {
		if (!this.vm) throw new Error("Orb is not running. Use start first");
		return this.vm;
	}
	private status() {
		return {
			name: this.record.name,
			state: this.state,
			resources:
				this.record.config.resources ?? profiles[this.record.config.profile],
			diskGiB: this.record.config.diskGiB,
			portals: Object.fromEntries(
				[...this.portals].map(([name, portal]) => [name, portal.url]),
			),
			persistence: "disk-only",
			...(this.startupError ? { startupError: this.startupError } : {}),
			...(this.recovery ? { recovery: this.recovery } : {}),
		};
	}
	private async persistStatus(): Promise<void> {
		await saveJson(join(this.dir, "status.json"), this.status());
	}
	private async health(name: string): Promise<boolean> {
		const service = this.record.config.services[name];
		if (!service || !this.healthBase) return false;
		try {
			const response = await fetch(
				`${this.healthBase}/${name}${service.health ?? "/"}`,
				{ signal: AbortSignal.timeout(2000), redirect: "manual" },
			);
			await response.body?.cancel();
			return response.status >= 200 && response.status < 400;
		} catch {
			return false;
		}
	}
	async services(
		op: "ensure" | "status" | "restart" | "stop",
		selected?: string,
	): Promise<unknown> {
		const vm = this.requireVm();
		const configured = this.record.config.services;
		if (selected && !configured[selected])
			throw new Error(
				`Unknown service ${selected}. Inspect declared services first`,
			);
		const names = selected ? [selected] : Object.keys(configured);
		const result: unknown[] = [];
		for (const name of names) {
			const service = configured[name];
			if (!service) continue;
			if (op === "stop" || op === "restart") await stopService(vm, name);
			if (op === "ensure" || op === "restart") {
				await startService(vm, name, service, this.portals.get(name)?.url);
				const deadline = Date.now() + service.timeoutMs;
				while (!(await this.health(name))) {
					if (Date.now() > deadline)
						throw new Error(
							`Service ${name} started but is not responding. Read its logs, then restart or stop it`,
						);
					await new Promise((accept) => setTimeout(accept, 200));
				}
			}
			result.push({
				name,
				running: await serviceRunning(vm, name),
				responding: op !== "stop" && (await this.health(name)),
				port: service.port,
				portal: this.portals.get(name)?.url,
			});
		}
		if ((op === "ensure" || op === "restart") && !selected)
			this.startupError = undefined;
		return result;
	}
	async stop(prepare = false): Promise<unknown> {
		if (this.state === "stopped" || this.state === "prepared")
			return this.status();
		const vm = this.requireVm();
		this.state = "stopping";
		await this.persistStatus();
		await this.closeAccess();
		for (const name of Object.keys(this.record.config.services))
			await stopService(vm, name);
		await checked(vm, "sync");
		const next = join(this.dir, "disk.next.qcow2");
		try {
			await vm.checkpoint(next);
			this.vm = undefined;
			await rename(next, join(this.dir, "disk.qcow2"));
		} catch (error) {
			console.error(error);
			await vm.close();
			this.vm = undefined;
			this.state = "interrupted";
			this.recovery =
				"Checkpoint failed after VM shutdown. Start restores only the last completed checkpoint, or a fresh disk if none exists. Changes since that checkpoint were not saved";
			try {
				await this.persistStatus();
			} catch (statusError) {
				console.error(statusError);
			}
			throw new Error(this.recovery);
		}
		this.state = prepare ? "prepared" : "stopped";
		await this.persistStatus();
		return this.status();
	}
	get retired(): boolean {
		return this.state === "interrupted";
	}
	async handle(action: Action): Promise<unknown> {
		if (action.action === "inspect")
			return {
				name: this.record.name,
				createdAt: this.record.createdAt,
				template: this.record.template,
				workspace: this.record.config.workspace,
				status: this.status(),
				connected: true,
				services: Object.keys(this.record.config.services),
			};
		if (action.action === "stop") return this.stop();
		if (action.action === "destroy") {
			if (action.confirm !== this.record.name)
				throw new Error("confirm must match name");
			await this.closeAccess();
			await this.vm?.close();
			this.vm = undefined;
			return { name: this.record.name, state: "destroyed" };
		}
		const vm = this.requireVm();
		switch (action.action) {
			case "shell": {
				if (this.terminal && this.terminal.user !== action.user)
					throw new Error(
						`Guest terminal is already configured for ${this.terminal.user}. Stop and start the instance to choose another user`,
					);
				if (!this.terminal) {
					await checked(
						vm,
						"command -v sshd >/dev/null && command -v sandboxssh >/dev/null || { echo 'Guest terminal requires an image with OpenSSH server and Gondolin SSH helper'; exit 1; }",
					);
					const ssh = await vm.enableSsh({
						user: action.user,
						listenHost: "127.0.0.1",
						listenPort: 0,
					});
					const terminal = await openTerminal(ssh.port);
					this.terminal = {
						user: action.user,
						command: `ssh -p ${terminal.port} -i ${q(ssh.identityFile)} -o ForwardAgent=no -o ClearAllForwardings=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${action.user}@127.0.0.1`,
						close: async () => {
							await terminal.close();
							await ssh.close();
						},
					};
				}
				return {
					name: this.record.name,
					command: this.terminal.command,
					handoff:
						"Run this command in a terminal on this host. Start Pi in the guest and complete your own login. No host provider credentials were copied",
				};
			}
			case "exec":
				return execute(
					vm,
					action.cmd,
					action.cwd ?? this.record.config.workspace,
					action.timeoutMs,
				);
			case "read": {
				const result = await execute(
					vm,
					`head -c 65537 ${q(action.path)}`,
					"/",
					10000,
				);
				if (result.exitCode !== 0)
					throw new Error(`Guest file could not be read: ${result.output}`);
				return {
					path: action.path,
					content: result.output,
					truncated: result.truncated,
				};
			}
			case "write":
				await vm.fs.writeFile(action.path, action.content, {
					signal: AbortSignal.timeout(10000),
				});
				return { path: action.path, bytes: Buffer.byteLength(action.content) };
			case "services":
				return this.services(action.op, action.service);
			case "logs": {
				if (!action.service || !this.record.config.services[action.service])
					throw new Error("Choose a declared service for guest logs");
				return execute(
					vm,
					`tail -n ${action.lines} ${q(`${serviceRoot}/${action.service}.log`)}`,
					"/",
					10000,
				);
			}
			default:
				throw new Error("Action unavailable on a running instance");
		}
	}
	async fail(error: unknown): Promise<void> {
		console.error(error);
		this.state = "failed";
		await this.persistStatus();
		await this.closeAccess();
		await this.vm?.close();
	}
	private async closeAccess(): Promise<void> {
		await this.terminal?.close();
		this.terminal = undefined;
		for (const portal of this.portals.values()) await portal.close();
		this.portals.clear();
	}
}

export async function readIntent(
	dir: string,
): Promise<{ prepare: boolean; fresh: boolean }> {
	const { z } = await import("zod");
	return z
		.strictObject({ prepare: z.boolean(), fresh: z.boolean() })
		.parse(JSON.parse(await readFile(join(dir, "intent.json"), "utf8")));
}
