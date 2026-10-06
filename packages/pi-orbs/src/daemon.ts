import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { actionSchema } from "./contracts.ts";
import { OrbRuntime, readIntent } from "./runtime.ts";
import { readRecord } from "./storage.ts";

async function main(): Promise<void> {
	const dir = process.argv[2];
	if (!dir) throw new Error("Instance directory required");
	const record = await readRecord(dir);
	const pidFile = join(dir, "controller.pid");
	await writeFile(pidFile, String(process.pid), { mode: 0o600 });
	const runtime = new OrbRuntime(dir, record);
	const intent = await readIntent(dir);
	try {
		await runtime.boot(intent.prepare, intent.fresh);
	} catch (error) {
		await runtime.fail(error);
		await rm(pidFile, { force: true });
		process.exitCode = 1;
		return;
	}
	if (intent.prepare) {
		await rm(pidFile, { force: true });
		return;
	}
	let queue: Promise<unknown> = Promise.resolve();
	const socket = join(dir, "control.sock");
	const server = http.createServer((req, res) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => {
			body += chunk;
			if (body.length > 8388608) req.destroy();
		});
		req.on("end", () => {
			const handle = async () => {
				try {
					const action = actionSchema.parse(JSON.parse(body));
					if (!("name" in action) || action.name !== record.name)
						throw new Error("Orb name does not match this instance");
					const result = await runtime.handle(action);
					res.end(JSON.stringify({ ok: true, result }));
					if (action.action === "stop" || action.action === "destroy") {
						server.close();
						await rm(socket, { force: true });
					}
				} catch (error) {
					console.error(error);
					if (runtime.retired) {
						server.close();
						await rm(socket, { force: true });
						await rm(pidFile, { force: true });
					}
					res.end(
						JSON.stringify({
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Orb operation failed. Inspect its state and logs before retrying",
						}),
					);
				}
			};
			// Inspection is read-only and must remain available while an owned
			// command or service health check waits. Mutations stay serialized.
			let inspect = false;
			try {
				inspect = actionSchema.parse(JSON.parse(body)).action === "inspect";
			} catch {}
			if (inspect) void handle();
			else queue = queue.catch(() => {}).then(handle);
		});
	});
	await new Promise<void>((accept, reject) => {
		server.once("error", reject);
		server.listen(socket, accept);
	});
	await chmod(socket, 0o600);
	server.once("close", () => {
		void readFile(pidFile, "utf8")
			.then(async (pid) => {
				if (Number(pid) === process.pid) await rm(pidFile, { force: true });
			})
			.catch((error: unknown) => {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					console.error(error);
			});
	});
	let ending = false;
	const shutdown = () => {
		if (ending) return;
		ending = true;
		queue = queue
			.catch(() => {})
			.then(async () => {
				await runtime.stop();
				server.close();
				await rm(socket, { force: true });
			})
			.catch(async (error: unknown) => {
				await runtime.fail(error);
				server.close();
			});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}
await main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
