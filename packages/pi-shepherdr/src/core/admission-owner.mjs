import { createHash } from "node:crypto";
import { lstat, rmdir, unlink } from "node:fs/promises";

/** @typedef {{path:string,marker:string}} StartupLease */

/** Startup travels through stdin, not argv: endpoint names stay private to the OS user.
 * The parent atomically transfers its directory marker before allowing the child to bind.
 * @returns {Promise<{endpoint:string, lease:StartupLease}>}
 */
export async function readAdmissionStart() {
	const timer = setTimeout(
		() => process.stdin.destroy(new Error("Startup expired")),
		5000,
	);
	try {
		let frame = "";
		for await (const chunk of process.stdin) {
			frame += chunk;
			if (Buffer.byteLength(frame) > 8192)
				throw new Error("Invalid startup frame");
		}
		const value = JSON.parse(frame);
		if (
			!value ||
			typeof value.endpoint !== "string" ||
			!value.endpoint ||
			!value.lease ||
			typeof value.lease.path !== "string" ||
			typeof value.lease.marker !== "string" ||
			!new RegExp(`^${process.pid}-[a-zA-Z0-9]+$`).test(value.lease.marker) ||
			createHash("sha256").update(value.endpoint).digest("hex") !==
				process.argv[2]
		)
			throw new Error("Invalid startup owner");
		const marker = await lstat(`${value.lease.path}/${value.lease.marker}`);
		if (!marker.isFile() || (process.getuid && marker.uid !== process.getuid()))
			throw new Error("Startup ownership changed");
		return value;
	} finally {
		clearTimeout(timer);
	}
}

/** @param {StartupLease} lease */
export async function releaseAdmissionStart(lease) {
	await unlink(`${lease.path}/${lease.marker}`).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	await rmdir(lease.path).catch((error) => {
		if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
	});
}
