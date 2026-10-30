import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { VM } from "@earendil-works/gondolin";
import { z } from "zod";
import type { Service } from "./contracts.ts";
import { checked, serviceRunning, startService, stopService } from "./guest.ts";
import { openPortal } from "./portals.ts";
import {
	ServiceDeclarations,
	serviceReference,
} from "./service-declarations.ts";
import { existsError, shellQuote as q, saveJson } from "./storage.ts";

type Links = Service["previews"];
type Entry = {
	service: Service;
	declared: boolean;
	port: number;
	portal: Awaited<ReturnType<typeof openPortal>> | undefined;
	links: Links;
};
const assignmentsSchema = z.record(
	z.string(),
	z.strictObject({
		port: z.number().int().min(1).max(65535),
		portalPort: z.number().int().min(1).max(65535).optional(),
	}),
);

export class GuestServices {
	private entries = new Map<string, Entry>();
	private assignments: z.infer<typeof assignmentsSchema> = {};
	private base: string | undefined;
	private attached = new Map<number, Awaited<ReturnType<typeof openPortal>>>();
	private definitions: ServiceDeclarations;
	private vm: VM;
	private dir: string;
	readonly configPath: string;
	private workspace: string;
	constructor(vm: VM, dir: string, configPath: string, workspace: string) {
		this.vm = vm;
		this.dir = dir;
		this.configPath = configPath;
		this.workspace = workspace;
		this.definitions = new ServiceDeclarations(vm, dir, configPath);
	}
	async initialize(): Promise<void> {
		try {
			this.assignments = assignmentsSchema.parse(
				JSON.parse(await readFile(join(this.dir, "services.json"), "utf8")),
			);
		} catch (error) {
			if (!existsError(error, "ENOENT")) throw error;
		}

		await this.definitions.initialize();
	}
	private async configure(
		name: string,
		service: Service,
		declared: boolean,
		preserve = false,
	): Promise<Entry> {
		const current = this.entries.get(name);
		if (preserve && current)
			service = {
				...service,
				preview: current.service.preview,
				previews: current.service.previews,
			};
		let port = current?.port ?? this.assignments[name]?.port ?? service.port;
		if (!port) {
			const reserved = [
				...this.definitions.reservedPorts,
				...Object.values(this.assignments).map((entry) => entry.port),
				...[...this.entries.values()].map((entry) => entry.port),
			];
			port = Number(
				(
					await checked(
						this.vm,
						`python3 -c ${q("import json,socket,sys; reserved=json.loads(sys.argv[1]); s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1];\nwhile port in reserved:\n s.close(); s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]\nprint(port)")} ${q(JSON.stringify(reserved))}`,
					)
				).trim(),
			);
		}
		for (const [other, assignment] of Object.entries(this.assignments))
			if (other !== name && assignment.port === port)
				throw new Error(`Service port ${port} is already assigned to ${other}`);
		let portal = current?.portal;
		const hasLinks = !!service.preview || service.previews.length > 0;
		if (!this.base)
			this.base = (
				await this.vm.enableIngress({ listenHost: "127.0.0.1", listenPort: 0 })
			).url;
		if (hasLinks && !portal)
			portal = await openPortal(
				new URL(this.base),
				`/${name}`,
				this.assignments[name]?.portalPort,
			);
		if (!hasLinks && portal) {
			await portal.close();
			portal = undefined;
		}
		const links: Links = [
			...(service.preview
				? [
						typeof service.preview === "boolean"
							? { url: "/", title: name }
							: { ...service.preview, title: service.preview.title ?? name },
					]
				: []),
			...service.previews,
		];
		const publicLinks = links.map((link) =>
			"folder" in link
				? {
						...link,
						links: link.links.map((item) => ({
							...item,
							url: new URL(item.url, portal?.url).href,
						})),
					}
				: { ...link, url: new URL(link.url, portal?.url).href },
		);
		const entry = { service, declared, port, portal, links: publicLinks };
		this.entries.set(name, entry);
		this.assignments[name] = {
			port,
			...(portal ? { portalPort: Number(new URL(portal.url).port) } : {}),
		};
		await saveJson(join(this.dir, "services.json"), this.assignments);
		this.routes();
		return entry;
	}
	private routes(): void {
		this.vm.setIngressRoutes([
			...[...this.entries].map(([name, entry]) => ({
				prefix: `/${name}/`,
				port: entry.port,
				stripPrefix: true,
			})),
			...[...this.attached.keys()].map((port) => ({
				prefix: `/port-${port}/`,
				port,
				stripPrefix: true,
			})),
		]);
	}
	async attach(
		port: number,
		title?: string,
		description?: string,
	): Promise<unknown> {
		let portal =
			[...this.entries.values()].find((entry) => entry.port === port)?.portal ??
			this.attached.get(port);
		if (!portal) {
			if (!this.base)
				this.base = (
					await this.vm.enableIngress({
						listenHost: "127.0.0.1",
						listenPort: 0,
					})
				).url;
			portal = await openPortal(new URL(this.base), `/port-${port}`);
			this.attached.set(port, portal);
			this.routes();
		}
		return {
			port,
			url: portal.url,
			title: title ?? `Port ${port}`,
			...(description ? { description } : {}),
			supervised: false,
		};
	}
	private async healthy(name: string, entry: Entry): Promise<boolean> {
		if (entry.service.health === "process")
			return serviceRunning(this.vm, name);
		const listening = await checked(
			this.vm,
			`python3 -c ${q("import socket,sys; s=socket.socket(); s.settimeout(1); print(s.connect_ex(('127.0.0.1',int(sys.argv[1])))==0); s.close()")} ${entry.port}`,
		);
		if (listening.trim() !== "True") return false;
		if (!entry.service.health) return true;
		try {
			const response = await fetch(
				`${this.base}/${name}${entry.service.health}`,
				{ signal: AbortSignal.timeout(2000), redirect: "manual" },
			);
			await response.body?.cancel();
			return response.status >= 200 && response.status < 400;
		} catch {
			return false;
		}
	}
	private async start(
		name: string,
		entry: Entry,
		timeoutMs: number,
	): Promise<void> {
		const env = Object.fromEntries(
			Object.entries(entry.service.env).map(([key, value]) => [
				key,
				value.replace(serviceReference, (_match, dependency: string) => {
					const url = this.entries.get(dependency)?.portal?.url;
					if (!url)
						throw new Error(
							`Service ${dependency} has no public URL. Ensure its preview first`,
						);
					return url;
				}),
			]),
		);
		await startService(
			this.vm,
			name,
			{
				...entry.service,
				cwd: posix.resolve(this.workspace, entry.service.cwd),
				port: entry.port,
				env,
			},
			entry.portal?.url,
		);
		const deadline = Date.now() + timeoutMs;
		while (!(await this.healthy(name, entry))) {
			if (Date.now() >= deadline)
				throw new Error(
					`Service ${name} started but is not responding. Its configured links are not proof of readiness. Read logs, then restart or stop it`,
				);
			await new Promise((accept) => setTimeout(accept, 200));
		}
	}
	async operate(
		op: "ensure" | "status" | "restart" | "stop",
		selected?: string,
	): Promise<unknown> {
		const config = op === "stop" ? {} : await this.definitions.read();
		if (selected && !config[selected] && !this.entries.has(selected))
			throw new Error(`Unknown service ${selected}. Edit ${this.configPath}`);
		if (op === "ensure" || op === "restart") {
			// A reopened controller has no active entries. Reconcile disk-backed
			// service ownership first, not only processes in this controller.
			// Attached raw portals have separate ownership and routes.
			for (const name of Object.keys(this.assignments)) {
				if (!config[name] || !this.definitions.eligible(config[name]))
					delete this.assignments[name];
			}
			for (const [name, entry] of this.entries) {
				if (
					entry.declared &&
					(!config[name] || !this.definitions.eligible(config[name]))
				) {
					await stopService(this.vm, name);
					await entry.portal?.close();
					this.entries.delete(name);
					delete this.assignments[name];
				}
			}
			await saveJson(join(this.dir, "services.json"), this.assignments);
			this.routes();
			if (selected && !config[selected] && !this.entries.has(selected))
				throw new Error(
					`Service ${selected} is no longer declared. Edit ${this.configPath}`,
				);
		}
		let names = selected
			? [selected]
			: [...new Set([...Object.keys(config), ...this.entries.keys()])];
		names = names.filter((name) =>
			this.definitions.eligible(
				config[name] ?? this.entries.get(name)!.service,
			),
		);
		if (op === "ensure" || op === "restart") {
			names = this.definitions.order(config, names, this.entries);
			for (const name of names) {
				const definition = config[name] ?? this.entries.get(name)!.service;
				// Ensure does not silently replace a live process's environment.
				const entry = await this.configure(
					name,
					definition,
					this.definitions.declaredNames.has(name),
					op === "restart",
				);
				if (op === "restart" && (!selected || selected === name))
					await stopService(this.vm, name);
				await this.start(name, entry, entry.service.timeoutMs);
			}
		} else if (op === "stop")
			for (const name of names) await stopService(this.vm, name);
		return Promise.all(
			names.map(async (name) => {
				const entry = this.entries.get(name);
				return {
					name,
					declared: entry?.declared ?? this.definitions.declaredNames.has(name),
					running: await serviceRunning(this.vm, name),
					responding:
						op !== "stop" && !!entry && (await this.healthy(name, entry)),
					port: entry?.port ?? config[name]?.port,
					preview: entry?.portal?.url,
					links: entry?.links ?? [],
				};
			}),
		);
	}
	async adHoc(name: string, service: Service): Promise<unknown> {
		const config = await this.definitions.read();
		if (this.definitions.declaredNames.has(name))
			throw new Error(
				`Service ${name} is declared. Use services ensure or restart`,
			);
		if (this.entries.has(name) || this.definitions.hasAdHoc(name))
			throw new Error(`Service ${name} already exists. Use services restart`);
		if (!this.definitions.eligible(service))
			return { name, skipped: "Service excludes the Linux guest" };
		this.definitions.order(
			{ ...config, [name]: service },
			[name],
			this.entries,
		);
		for (const dependency of this.definitions
			.order({ ...config, [name]: service }, [name], this.entries)
			.filter((key) => key !== name))
			await this.operate("ensure", dependency);
		const entry = await this.configure(name, service, false);
		await this.definitions.register(name, service);
		await this.start(name, entry, 60000);
		return this.operate("status", name);
	}
	urls(): Record<string, string> {
		return Object.fromEntries(
			[...this.entries].flatMap(([name, entry]) =>
				entry.portal ? [[name, entry.portal.url]] : [],
			),
		);
	}
	names(): string[] {
		return [...this.entries.keys()];
	}
	async close(): Promise<void> {
		for (const entry of this.entries.values()) {
			await entry.portal?.close();
			entry.portal = undefined;
		}
		for (const portal of this.attached.values()) await portal.close();
		this.attached.clear();
	}
	async stopAll(): Promise<void> {
		for (const name of this.entries.keys()) await stopService(this.vm, name);
	}
}
