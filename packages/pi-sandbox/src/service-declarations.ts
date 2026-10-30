import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VM } from "@earendil-works/gondolin";
import { parseDocument } from "yaml";
import { configSchema, type Service } from "./contracts.ts";
import { existsError, saveJson } from "./storage.ts";

export const serviceReference =
	/\$\{services\.([a-z0-9][a-z0-9-]{0,31})\.publicURL\}/g;

export class ServiceDeclarations {
	private adHocConfig: Record<string, Service> = {};
	declaredNames = new Set<string>();
	reservedPorts: number[] = [];
	private vm: VM;
	private dir: string;
	readonly configPath: string;
	constructor(vm: VM, dir: string, configPath: string) {
		this.vm = vm;
		this.dir = dir;
		this.configPath = configPath;
	}
	async initialize(): Promise<void> {
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
	hasAdHoc(name: string): boolean {
		return !!this.adHocConfig[name];
	}
	async register(name: string, service: Service): Promise<void> {
		this.adHocConfig[name] = service;
		await saveJson(join(this.dir, "adhoc.json"), this.adHocConfig);
	}
	async read(): Promise<Record<string, Service>> {
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
	eligible(service: Service): boolean {
		return !service.platforms || service.platforms.includes("linux");
	}
	order(
		config: Record<string, Service>,
		names: string[],
		entries: ReadonlyMap<string, { service: Service }>,
	): string[] {
		const ordered: string[] = [];
		const visiting = new Set<string>();
		const visit = (name: string) => {
			if (ordered.includes(name)) return;
			if (visiting.has(name))
				throw new Error(
					`Service dependency cycle at ${name}. Correct env references in ${this.configPath}`,
				);
			const service = config[name] ?? entries.get(name)?.service;
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
				for (const match of value.matchAll(serviceReference)) {
					const dependency = match[1];
					if (!dependency) continue;
					const target = config[dependency];
					if (
						!target ||
						!this.declaredNames.has(dependency) ||
						(!target.preview && !target.previews.length)
					)
						throw new Error(
							`Service ${name} references ${dependency}, which must be declared with a preview`,
						);
					visit(dependency);
				}
			visiting.delete(name);
			ordered.push(name);
		};
		for (const name of names) visit(name);
		return ordered;
	}
}
