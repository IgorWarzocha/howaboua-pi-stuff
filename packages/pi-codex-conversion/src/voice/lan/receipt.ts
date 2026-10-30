import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function isVoiceRequestId(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}

export interface LanReceipt {
	version: 1;
	requestId: string;
	action: "ensure" | "status" | "connect";
	sessionId: string;
	terminalId: string | null;
	provider: "codex";
	status: "running" | "stopped" | "error";
	running: boolean;
	urls: string[];
	browserAttached: boolean;
	browserRoute?: string;
	browserStatus?: "listening" | "error" | "timeout";
	browserError?: string;
	browserUrl?: string;
	browserRefId?: string;
	error?: string;
}

/** The caller owns reading/removing its receipt; no caller-controlled paths. */
export async function writeLanReceipt(
	agentDir: string,
	receipt: LanReceipt,
): Promise<void> {
	if (!isVoiceRequestId(receipt.requestId))
		throw new Error("Use a UUID v4 request ID");
	const directory = join(agentDir, "runtime", "voice-requests");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const info = await lstat(directory);
	if (
		!info.isDirectory() ||
		(process.platform !== "win32" &&
			(info.mode & 0o077 || info.uid !== process.getuid?.()))
	)
		throw new Error(
			"Voice receipt directory must be private and owned by the current user",
		);
	const path = join(directory, `${receipt.requestId}.json`);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(receipt)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
