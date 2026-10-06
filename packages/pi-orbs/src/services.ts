import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { VM } from "@earendil-works/gondolin";
import { parseDocument } from "yaml";
import { z } from "zod";
import { configSchema, type Service } from "./contracts.ts";
import { checked, serviceRunning, startService, stopService } from "./guest.ts";
import { openPortal } from "./portals.ts";
import { existsError, shellQuote as q, saveJson } from "./storage.ts";

const reference = /\$\{services\.([a-z0-9][a-z0-9-]{0,31})\.publicURL\}/g;
type Links = Service["portals"];
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
	private reservedPorts: number[] = [];
	private attached = new Map<number, Awaited<ReturnType<typeof openPortal>>>();
	private adHocConfig: Record<string, Service> = {};
	private declaredNames = new Set<string>();
	private vm: VM;
	private dir: string;
	readonly configPath: string;
	private workspace: string;
	constructor(vm: VM, dir: string, configPath: string, workspace: string) {
		this.vm = vm;
		this.dir = dir;
		this.configPath = configPath;
		this.workspace = workspace;
	}
	async initialize(): Promise<void> {
		try {
			this.assignments = assignmentsSchema.parse(
				JSON.parse(await readFile(join(this.dir, "services.json"), "utf8")),
			);
		} catch (error) {
			if (!existsError(error, "ENOENT")) throw error;
		}
		try {
			this.adHocConfig = configSchema.parse({
				services: JSON.parse(
					await readFile(join(this.dir, "adhoc.json"), "utf8"),
				),
			}).services;
		} catch (error) {
			if (!existsError(error, "ENOENT")) throw error;
		}
	}
	private async declarations(): Promise<Record<string, Service>> {
		if ((await this.vm.fs.stat(this.configPath)).size > 1048576)
			throw new Error("Service YAML exceeds 1 MiB");
		const text = await this.vm.fs.readFile(this.configPath, {
			encoding: "utf8",
		});
		if (Buffer.byteLength(text) > 1048576)
			throw new Error("Service YAML exceeds 1 MiB");
		const document = parseDocument(text, { uniqueKeys: true });
		if (document.errors.length)
			throw new Error(`Invalid service YAML: ${document.errors[0]?.message}`);
		const services = configSchema.parse(
			document.toJS({ maxAliasCount: 20 }),
		).services;
		this.declaredNames = new Set(Object.keys(services));
		let promoted = false;
		for (const name of this.declaredNames) {
			if (this.adHocConfig[name]) {
				delete this.adHocConfig[name];
				promoted = true;
			}
		}
		if (promoted)
			await saveJson(join(this.dir, "adhoc.json"), this.adHocConfig);
		this.reservedPorts = Object.values(services).flatMap((service) =>
			service.port ? [service.port] : [],
		);
		return { ...this.adHocConfig, ...services };
	}
	private eligible(service: Service): boolean {
		return !service.platforms || service.platforms.includes("linux");
	}
	private order(config: Record<string, Service>, names: string[]): string[] {
		const ordered: string[] = [];
		const visiting = new Set<string>();
		const visit = (name: string) => {
			if (ordered.includes(name)) return;
			if (visiting.has(name))
				throw new Error(
					`Service dependency cycle at ${name}. Correct env references in ${this.configPath}`,
				);
			const service = config[name] ?? this.entries.get(name)?.service;
			if (!service)
				throw new Error(
					`Unknown service ${name}. Edit ${this.configPath} or use service-start`,
				);
			if (!this.eligible(service))
				throw new Error(
					`Referenced service ${name} excludes the guest's Linux platform`,
				);
			visiting.add(name);
			for (const value of Object.values(service.env))
				for (const match of value.matchAll(reference)) {
					const dependency = match[1];
					if (!dependency) continue;
					const target = config[dependency];
					if (
						!target ||
						!this.declaredNames.has(dependency) ||
						(!target.portal && !target.portals.length)
					)
						throw new Error(
							`Service ${name} references ${dependency}, which must be declared with a portal`,
						);
					visit(dependency);
				}
			visiting.delete(name);
			ordered.push(name);
		};
		for (const name of names) visit(name);
		return ordered;
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
				portal: current.service.portal,
				portals: current.service.portals,
			};
		let port = current?.port ?? this.assignments[name]?.port ?? service.port;
		if (!port) {
			const reserved = [
				...this.reservedPorts,
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
		const hasLinks = !!service.portal || service.portals.length > 0;
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
			...(service.portal
				? [
						typeof service.portal === "boolean"
							? { url: "/", title: name }
							: { ...service.portal, title: service.portal.title ?? name },
					]
				: []),
			...service.portals,
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
				value.replace(reference, (_match, dependency: string) => {
					const url = this.entries.get(dependency)?.portal?.url;
					if (!url)
						throw new Error(
							`Service ${dependency} has no public URL. Ensure its portal first`,
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
		const config = op === "stop" ? {} : await this.declarations();
		if (selected && !config[selected] && !this.entries.has(selected))
			throw new Error(`Unknown service ${selected}. Edit ${this.configPath}`);
		if (op === "ensure" || op === "restart") {
			// A reopened controller has no active entries. Reconcile disk-backed
			// service ownership first, not only processes in this controller.
			// Attached raw portals have separate ownership and routes.
			for (const name of Object.keys(this.assignments)) {
				if (!config[name] || !this.eligible(config[name]))
					delete this.assignments[name];
			}
			for (const [name, entry] of this.entries) {
				if (entry.declared && (!config[name] || !this.eligible(config[name]))) {
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
			this.eligible(config[name] ?? this.entries.get(name)!.service),
		);
		if (op === "ensure" || op === "restart") {
			names = this.order(config, names);
			for (const name of names) {
				const definition = config[name] ?? this.entries.get(name)!.service;
				// Ensure does not silently replace a live process's environment.
				const entry = await this.configure(
					name,
					definition,
					this.declaredNames.has(name),
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
					declared: entry?.declared ?? this.declaredNames.has(name),
					running: await serviceRunning(this.vm, name),
					responding:
						op !== "stop" && !!entry && (await this.healthy(name, entry)),
					port: entry?.port ?? config[name]?.port,
					portal: entry?.portal?.url,
					links: entry?.links ?? [],
				};
			}),
		);
	}
	async adHoc(name: string, service: Service): Promise<unknown> {
		const config = await this.declarations();
		if (this.declaredNames.has(name))
			throw new Error(
				`Service ${name} is declared. Use services ensure or restart`,
			);
		if (this.entries.has(name) || this.adHocConfig[name])
			throw new Error(`Service ${name} already exists. Use services restart`);
		if (!this.eligible(service))
			return { name, skipped: "Service excludes the Linux guest" };
		this.order({ ...config, [name]: service }, [name]);
		for (const dependency of this.order({ ...config, [name]: service }, [
			name,
		]).filter((key) => key !== name))
			await this.operate("ensure", dependency);
		const entry = await this.configure(name, service, false);
		this.adHocConfig[name] = service;
		await saveJson(join(this.dir, "adhoc.json"), this.adHocConfig);
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
