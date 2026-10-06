import { access, readFile, rename } from "node:fs/promises";
import { join, posix } from "node:path";
import {
	createHttpHooks,
	VM,
	type VMOptions,
	VmCheckpoint,
} from "@earendil-works/gondolin";
import { type Action, profiles, type SandboxRecord } from "./contracts.ts";
import { checked, execute, guestExists, serviceRoot } from "./guest.ts";
import { openTerminal } from "./portals.ts";
import { GuestProcesses } from "./processes.ts";
import { GuestServices } from "./services.ts";
import { existsError, shellQuote as q, saveJson } from "./storage.ts";

export class SandboxRuntime {
	private vm: VM | undefined;
	private processes: GuestProcesses | undefined;
	private managed: GuestServices | undefined;
	private startupError: string | undefined;
	private resumePid: number | undefined;
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
	private record: SandboxRecord;
	constructor(dir: string, record: SandboxRecord) {
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
			sessionLabel: `pi-sandbox:${this.record.name}`,
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
		this.processes = new GuestProcesses(vm);
		// Disabling scratch tmpfs preserves HOME on disk. OCI images still need
		// normal Unix temporary-directory permissions for unprivileged tools.
		await checked(vm, "mkdir -p /tmp /var/tmp; chmod 1777 /tmp /var/tmp");
		await checked(vm, `mkdir -p ${q(config.workspace)}`);
		// A checkpoint restores filesystem files, not processes. Old service pid
		// files must never be mistaken for newly booted unrelated processes.
		await checked(
			vm,
			`rm -f ${serviceRoot}/*.pid; rm -rf /var/lib/pi-sandbox/commands`,
		);
		const configPath = posix.join(config.workspace, ".sandbox.yaml");
		if (!(await guestExists(vm, configPath)))
			await vm.fs.writeFile(configPath, JSON.stringify(config, null, 2));
		if (fresh || !resume) {
			const setup = [
				...config.setup,
				"if test -x .agents/setup; then .agents/setup; fi",
			];
			if (setup.length) {
				const pid = await this.processes.launch(
					setup.map((cmd) => `/bin/sh -lc ${q(cmd)} || exit $?`).join("\n"),
					config.workspace,
					true,
					1200,
				);
				let result = await this.processes.status(pid, 60000);
				while (result.running) {
					console.log(result.output);
					result = await this.processes.status(pid, 60000);
				}
				console.log(result.output);
				if (result.exitCode !== 0) {
					this.startupError = `Setup exited ${result.exitCode}. Read controller logs. No prepared template was published`;
					if (prepare) throw new Error(this.startupError);
				}
			}
			await saveJson(join(this.dir, "intent.json"), { prepare, fresh: false });
		}
		if (prepare) {
			await this.stop(true);
			return;
		}
		const hooks = [...config.resume];
		if (await guestExists(vm, posix.join(config.workspace, ".agents/resume")))
			hooks.push("if test -x .agents/resume; then .agents/resume; fi");
		if (hooks.length) {
			const pid = await this.processes.launch(
				hooks.map((cmd) => `/bin/sh -lc ${q(cmd)} || exit $?`).join("\n"),
				config.workspace,
			);
			const result = await this.processes.status(pid, 10000);
			console.log(result.output);
			if (result.running) {
				this.resumePid = pid;
				console.log(`Resume continues in background: ${pid}`);
			} else if (result.exitCode !== 0)
				console.error(`Resume exited ${result.exitCode}`);
		}
		this.managed = new GuestServices(
			vm,
			this.dir,
			configPath,
			config.workspace,
		);
		await this.managed.initialize();
		this.state = "running";
		await this.persistStatus();
		try {
			await this.managed.operate("ensure");
		} catch (error) {
			this.startupError =
				error instanceof Error
					? error.message
					: "Service readiness failed. Read service logs";
			console.error(error);
		}
		await this.persistStatus();
	}
	private requireVm(): VM {
		if (!this.vm) throw new Error("Sandbox is not running. Use start first");
		return this.vm;
	}
	private status() {
		return {
			name: this.record.name,
			state: this.state,
			resources:
				this.record.config.resources ?? profiles[this.record.config.profile],
			diskGiB: this.record.config.diskGiB,
			previews: this.managed?.urls() ?? {},
			persistence: "disk-only",
			...(this.startupError ? { startupError: this.startupError } : {}),
			...(this.resumePid ? { resumePid: this.resumePid } : {}),
			...(this.recovery ? { recovery: this.recovery } : {}),
		};
	}
	private async persistStatus(): Promise<void> {
		await saveJson(join(this.dir, "status.json"), this.status());
	}
	async stop(prepare = false): Promise<unknown> {
		if (this.state === "stopped" || this.state === "prepared")
			return this.status();
		const vm = this.requireVm();
		this.state = "stopping";
		await this.persistStatus();
		await this.closeAccess();
		await this.managed?.stopAll();
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
				configPath: posix.join(this.record.config.workspace, ".sandbox.yaml"),
				status: this.status(),
				connected: true,
				services: this.managed?.names() ?? [],
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
		if (this.state !== "running")
			throw new Error(
				"Sandbox is stopping. Wait for stop to complete, then use start",
			);
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
				return this.processes!.status(
					await this.processes!.launch(
						action.cmd,
						posix.resolve(this.record.config.workspace, action.cwd ?? "."),
					),
					action.timeoutMs,
				);
			case "exec-status":
				return this.processes!.status(action.pid, action.timeoutMs);
			case "exec-kill":
				return this.processes!.kill(action.pid);
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
				return this.managed!.operate(action.op, action.service);
			case "service-start": {
				const {
					action: _action,
					name: _name,
					service,
					title,
					description,
					...definition
				} = action;
				if (definition.preview && (title || description))
					definition.preview = {
						...(typeof definition.preview === "boolean"
							? { url: "/" }
							: definition.preview),
						...(title ? { title } : {}),
						...(description ? { description } : {}),
					};
				return this.managed!.adHoc(service, definition);
			}
			case "preview":
				return this.managed!.attach(
					action.port,
					action.title,
					action.description,
				);
			case "logs": {
				if (!action.service || !this.managed?.names().includes(action.service))
					throw new Error("Choose a started service for guest logs");
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
		await this.managed?.close();
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
