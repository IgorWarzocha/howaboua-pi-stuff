import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Action, actionSchema, statusSchema } from "./contracts.ts";
import {
	controllerAlive,
	launch,
	offline,
	reachable,
	request,
} from "./controller.ts";
import {
	directory,
	existsError,
	loadConfig,
	privateDirectory,
	readLogTail,
	readRecord,
	saveJson,
	stateRoot,
} from "./storage.ts";

async function create(
	root: string,
	action: Extract<Action, { action: "create" | "prepare" }>,
	cwd: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const kind = action.action === "prepare" ? "templates" : "instances";
	const dir = directory(root, kind, action.name);
	const template = action.action === "create" ? action.template : undefined;
	const source = template ? directory(root, "templates", template) : undefined;
	if (source) {
		const status = statusSchema.parse(
			JSON.parse(await readFile(join(source, "status.json"), "utf8")),
		);
		if (status.state !== "prepared")
			throw new Error(
				`Template ${template} is not prepared. Use list with kind templates to inspect preparation before creating an instance`,
			);
	}
	const config = source
		? (await readRecord(source)).config
		: await loadConfig(resolve(cwd, action.config ?? ""));
	await privateDirectory(join(root, kind));
	try {
		await mkdir(dir, { mode: 0o700 });
	} catch (error) {
		if (existsError(error, "EEXIST"))
			throw new Error(
				`${action.name} already exists. Use inspect or choose a new name`,
			);
		throw error;
	}
	try {
		await saveJson(join(dir, "record.json"), {
			version: 1,
			name: action.name,
			config,
			createdAt: new Date().toISOString(),
			...(template ? { template } : {}),
		});
		if (source)
			await copyFile(join(source, "disk.qcow2"), join(dir, "disk.qcow2"));
		await saveJson(join(dir, "intent.json"), {
			prepare: kind === "templates",
			fresh: !source,
		});
	} catch (error) {
		await rm(dir, { recursive: true, force: true });
		throw error;
	}
	try {
		return await launch(dir, action.name, signal);
	} catch (error) {
		if (signal?.aborted || action.action !== "prepare") throw error;
		const log = await readLogTail(join(dir, "controller.log"), 20);
		const output = log.output.slice(-4096);
		const detail =
			output ||
			(error instanceof Error
				? error.message
				: "No preparation output available");
		throw new Error(
			`Template ${action.name} preparation did not complete. Use list with kind templates to check its state. After its controller exits, destroy with kind templates, name ${action.name}, confirm ${action.name}, correct the YAML and prepare again. Preparation log${log.truncated || log.output.length > output.length ? " (earlier output omitted)" : ""}:\n${detail}`,
		);
	}
}
export async function run(
	input: unknown,
	cwd: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const action = actionSchema.parse(input);
	const root = stateRoot();
	await privateDirectory(root);
	if (action.action === "create" || action.action === "prepare")
		return create(root, action, cwd, signal);
	if (action.action === "list") {
		const base = join(root, action.kind);
		let names: string[];
		try {
			names = await readdir(base);
		} catch (error) {
			if (existsError(error, "ENOENT")) return [];
			throw error;
		}
		return Promise.all(
			names.sort().map(async (name) => {
				const dir = join(base, name);
				try {
					return await request(
						dir,
						{ action: "inspect", name },
						AbortSignal.timeout(1500),
					);
				} catch {
					return offline(dir);
				}
			}),
		);
	}
	const kind = action.action === "destroy" ? action.kind : "instances";
	const dir = directory(root, kind, action.name);
	await readRecord(dir);
	if (action.action === "logs" && !action.service) {
		return {
			name: action.name,
			...(await readLogTail(join(dir, "controller.log"), action.lines)),
		};
	}
	if (action.action === "start") return launch(dir, action.name, signal);
	if (action.action === "destroy") {
		if (action.confirm !== action.name)
			throw new Error("confirm must match name");
		if (await reachable(dir, action.name)) await request(dir, action, signal);
		else if (await controllerAlive(dir))
			throw new Error(
				"Sandbox controller is still starting or unavailable. Read its logs and wait before destroying it",
			);
		await rm(dir, { recursive: true });
		return { name: action.name, state: "destroyed" };
	}
	if (!(await reachable(dir, action.name))) {
		if (action.action === "inspect" || action.action === "stop")
			return offline(dir);
		throw new Error(`${action.name} is not running. Use start first`);
	}
	return request(dir, action, signal);
}
