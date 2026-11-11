import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	link,
	lstat,
	mkdir,
	readFile,
	realpath,
	unlink,
	writeFile,
} from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockStartup, pause } from "./admission-startup.js";

const runtimeDirectory = () =>
	join(userInfo().homedir, ".cache", "pi-shepherdr", "admission");

async function privateDirectory(directory: string): Promise<void> {
	await mkdir(directory, { mode: 0o700, recursive: true });
	const metadata = await lstat(directory);
	if (
		!metadata.isDirectory() ||
		metadata.isSymbolicLink() ||
		(process.getuid && metadata.uid !== process.getuid()) ||
		(process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
	)
		throw new Error(
			"Private agent runtime directory is not secure; check its ownership and permissions",
		);
}

/** A private, stable name; kernel-owned endpoints need no stale lock reclamation. */
export async function admissionEndpoint(
	core: string,
	destination: string,
): Promise<string> {
	const directory = runtimeDirectory();
	await privateDirectory(directory);
	const canonical =
		process.platform === "win32" ? core.toLowerCase() : await realpath(core);
	const key = createHash("sha256")
		.update(JSON.stringify([canonical, destination]))
		.digest("hex");
	const path = join(directory, key);
	const candidate = `${path}.${randomBytes(8).toString("hex")}`;
	await writeFile(candidate, randomBytes(24).toString("hex"), {
		flag: "wx",
		mode: 0o600,
	});
	try {
		// Publish complete contents atomically, including concurrent first clients.
		await link(candidate, path);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
	} finally {
		await unlink(candidate);
	}
	const token = await readFile(path, "utf8");
	if (!/^[a-f0-9]{48}$/.test(token))
		throw new Error(
			"Agent runtime endpoint is invalid; remove the invalid runtime file and reconnect",
		);
	if (process.platform === "linux") return `\0pi-shepherdr-${token}`;
	if (process.platform === "win32") return `\\\\.\\pipe\\pi-shepherdr-${token}`;
	// Core already needs a short Unix socket directory. Do not put a second
	// socket beneath an arbitrarily long home directory on Darwin/BSD.
	const sockets = join(
		dirname(canonical),
		`pi-sh-${process.getuid?.() ?? "user"}`,
	);
	const endpoint = join(sockets, `${token.slice(0, 24)}.sock`);
	if (Buffer.byteLength(endpoint) > 100)
		throw new Error(
			"Core runtime path is too long for agent operations; restart Core with a shorter runtime directory",
		);
	await privateDirectory(sockets);
	return endpoint;
}

function connect(path: string, signal: AbortSignal): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection({ path });
		const abort = () => failed(signal.reason);
		const failed = (error: Error) => {
			signal.removeEventListener("abort", abort);
			socket.destroy();
			reject(error);
		};
		socket.once("error", failed);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		socket.once("connect", () => {
			signal.removeEventListener("abort", abort);
			socket.removeListener("error", failed);
			resolve(socket);
		});
	});
}

/** Bind elects the owner; losing starters exit. Never retry an accepted operation. */
export async function connectAdmission(
	path: string,
	signal: AbortSignal,
): Promise<Socket> {
	const attempt = async () => {
		try {
			return await connect(path, signal);
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					["ENOENT", "ECONNREFUSED"].includes(String(error.code))
				)
			)
				throw error;
			return undefined;
		}
	};
	const existing = await attempt();
	if (existing) return existing;
	const filesystem =
		!path.startsWith("\0") && !path.startsWith("\\\\.\\pipe\\");
	const lockPath = filesystem
		? path
		: join(runtimeDirectory(), createHash("sha256").update(path).digest("hex"));
	const lock = await lockStartup(lockPath, signal);
	let transferred = false;
	try {
		const owner = await attempt();
		if (owner) return owner;
		if (filesystem) {
			// All filesystem binders hold this lock. A refused socket is stale,
			// but cannot be unlinked outside election without racing a new owner.
			await unlink(path).catch((error: unknown) => {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;
			});
		}
		signal.throwIfAborted();
		const child = spawn(
			process.execPath,
			[
				fileURLToPath(new URL("./admission-broker.mjs", import.meta.url)),
				createHash("sha256").update(path).digest("hex"),
			],
			{
				detached: true,
				stdio: ["pipe", "ignore", "ignore"],
				windowsHide: true,
			},
		);
		// Startup failure is reported through the bounded connection attempt.
		child.on("error", () => {});
		child.unref();
		if (!child.pid) throw new Error("Agent runtime did not start");
		const lease = await lock.handoff(child.pid);
		transferred = true;
		child.stdin.on("error", () => {});
		child.stdin.end(JSON.stringify({ endpoint: path, lease }));
		for (;;) {
			signal.throwIfAborted();
			const socket = await attempt();
			if (socket) return socket;
			await pause(signal);
		}
	} finally {
		if (!transferred) await lock.release();
	}
}
