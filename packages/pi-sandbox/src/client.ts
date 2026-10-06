import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import http from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	type Action,
	actionSchema,
	inspectionSchema,
	replySchema,
	statusSchema,
} from "./contracts.ts";
import { processIdentity } from "./identity.ts";
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

function request(
	dir: string,
	action: Action,
	signal?: AbortSignal,
): Promise<unknown> {
	return new Promise((accept, reject) => {
		const req = http.request(
			{
				socketPath: join(dir, "control.sock"),
				method: "POST",
				path: "/",
				signal: signal ?? AbortSignal.timeout(180000),
				headers: { "content-type": "application/json" },
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > 2097152)
						req.destroy(new Error("Sandbox response exceeds 2 MiB"));
				});
				res.on("error", reject);
				res.on("end", () => {
					try {
						const reply = replySchema.parse(JSON.parse(body));
						if (!reply.ok) reject(new Error(reply.error));
						else accept(reply.result);
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on("error", reject);
		req.end(JSON.stringify(action));
	});
}
async function reachable(
	dir: string,
	name: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		await request(
			dir,
			{ action: "inspect", name },
			signal
				? AbortSignal.any([signal, AbortSignal.timeout(1000)])
				: AbortSignal.timeout(1000),
		);
		return true;
	} catch (error) {
		if (existsError(error, "ENOENT") || existsError(error, "ECONNREFUSED"))
			return false;
		throw error;
	}
}
async function controllerAlive(dir: string): Promise<boolean> {
	try {
		const raw = await readFile(join(dir, "controller.pid"), "utf8");
		let identity: { pid: number; start: string } | number;
		try {
			identity = JSON.parse(raw);
			if (
				typeof identity !== "number" &&
				(!identity || typeof identity.start !== "string" || !identity.start)
			)
				throw new Error("Invalid identity");
		} catch {
			throw new Error(
				"Sandbox controller identity is invalid. Inspect its logs before retrying",
			);
		}
		const pid = typeof identity === "number" ? identity : identity.pid;
		if (!Number.isSafeInteger(pid) || pid <= 0)
			throw new Error(
				"Sandbox controller identity is invalid. Inspect its logs before retrying",
			);
		try {
			process.kill(pid, 0);
			if (typeof identity === "number")
				throw new Error(
					"Sandbox controller ownership is from an older version. Ask the user to verify its process before removing controller.pid",
				);
			return identity.start === (await processIdentity(pid)).start;
		} catch (error) {
			if (existsError(error, "ESRCH")) return false;
			throw error;
		}
	} catch (error) {
		if (existsError(error, "ENOENT")) return false;
		throw error;
	}
}
async function launch(
	dir: string,
	name: string,
	signal?: AbortSignal,
): Promise<unknown> {
	signal?.throwIfAborted();
	if (await reachable(dir, name, signal))
		return request(dir, { action: "inspect", name }, signal);
	if (await controllerAlive(dir))
		throw new Error(
			"Sandbox controller is still starting or unavailable. Read controller logs before retrying",
		);
	if (Buffer.byteLength(join(dir, "control.sock")) >= 104)
		throw new Error(
			"Sandbox state path is too long for a local control socket. Ask the user to choose a shorter private PI_SANDBOX_HOME path",
		);
	let nodeVersion: string;
	try {
		nodeVersion = execFileSync("node", ["--version"], {
			encoding: "utf8",
			timeout: 3000,
		}).trim();
	} catch {
		throw new Error(
			"Starting a sandbox requires Node.js 24 or newer on PATH. Install Node.js, then retry start",
		);
	}
	if (Number(nodeVersion.match(/^v(\d+)\./)?.[1] ?? 0) < 24)
		throw new Error(
			`Node.js 24 or newer is required, found ${nodeVersion}. Update Node.js, then retry start`,
		);
	const lock = join(dir, "launch.lock");
	try {
		await mkdir(lock, { mode: 0o700 });
	} catch (error) {
		if (!existsError(error, "EEXIST")) throw error;
		const recovery = join(lock, "recovery");
		try {
			await mkdir(recovery, { mode: 0o700 });
		} catch {
			throw new Error(
				"Sandbox start or recovery is already in progress. Retry inspect shortly",
			);
		}
		try {
			const owner = Number(await readFile(join(lock, "owner"), "utf8"));
			if (!Number.isSafeInteger(owner) || owner <= 0)
				throw new Error(
					"Sandbox start ownership is unavailable. Read controller logs before retrying",
				);
			try {
				process.kill(owner, 0);
				throw new Error(
					"Sandbox start is already in progress. Retry inspect shortly",
				);
			} catch (ownerError) {
				if (!existsError(ownerError, "ESRCH")) throw ownerError;
			}
			if (await controllerAlive(dir))
				throw new Error(
					"Sandbox controller is still starting. Retry inspect shortly",
				);
			await rm(lock, { recursive: true });
			await mkdir(lock, { mode: 0o700 });
		} finally {
			await rm(recovery, { recursive: true, force: true });
		}
	}
	try {
		await writeFile(join(lock, "owner"), String(process.pid), { mode: 0o600 });
		await saveJson(join(dir, "status.json"), { state: "starting", name });
		await rm(join(dir, "control.sock"), { force: true });
		const fd = openSync(join(dir, "controller.log"), "a", 0o600);
		const env: NodeJS.ProcessEnv = {};
		for (const key of ["PATH", "HOME", "XDG_CACHE_HOME", "TMPDIR"])
			if (process.env[key]) env[key] = process.env[key];
		const child = spawn(
			"node",
			[fileURLToPath(new URL("./daemon.ts", import.meta.url)), dir],
			{ detached: true, stdio: ["ignore", fd, fd], env },
		);
		closeSync(fd);
		let failure: Error | undefined;
		child.on("error", (error) => {
			failure = error;
		});
		child.on("exit", (code) => {
			failure = new Error(
				`Sandbox controller exited (${code}). Inspect controller logs before retrying`,
			);
		});
		child.unref();
		for (let attempt = 0; attempt < 6000; attempt++) {
			await delay(250, undefined, { signal });
			const status = statusSchema.parse(
				JSON.parse(await readFile(join(dir, "status.json"), "utf8")),
			);
			if (status.state === "prepared") return offline(dir);
			if (status.state === "failed" || failure)
				throw (
					failure ??
					new Error(
						"Sandbox start failed. Read controller logs before retrying start",
					)
				);
			if (await reachable(dir, name, signal)) {
				const result = await request(dir, { action: "inspect", name }, signal);
				const inspect = inspectionSchema.parse(result);
				if (inspect.status.startupError)
					throw new Error(
						`${name} is running, but ${inspect.status.startupError}`,
					);
				return result;
			}
		}
		throw new Error(
			"Sandbox start has not completed. Use inspect or logs before retrying",
		);
	} finally {
		await rm(lock, { recursive: true, force: true });
	}
}
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
async function offline(dir: string): Promise<unknown> {
	const record = await readRecord(dir);
	let status = statusSchema.parse({
		name: record.name,
		state: "interrupted",
		recovery:
			"Use start. Only the last completed stop is preserved after a controller crash",
	});
	try {
		status = statusSchema.parse(
			JSON.parse(await readFile(join(dir, "status.json"), "utf8")),
		);
	} catch (error) {
		if (!existsError(error, "ENOENT")) throw error;
	}
	if (["starting", "running", "stopping"].includes(status.state)) {
		const alive = await controllerAlive(dir);
		status = {
			...status,
			state: alive ? "unavailable" : "interrupted",
			previews: {},
			recovery: alive
				? "Controller is starting or unavailable. Read controller logs and retry inspect"
				: "Controller exited without completing stop. Start restores only the last completed disk checkpoint",
		};
	}
	return {
		name: record.name,
		createdAt: record.createdAt,
		template: record.template,
		workspace: record.config.workspace,
		status,
		connected: false,
		services: Object.keys(record.config.services),
	};
}
