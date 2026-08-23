import { spawn } from "node:child_process";

const DIAGNOSTIC_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_CHARS = 8_192;

export async function diagnoseDenoSyntax(
	deno: string,
	source: string,
	env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = spawn(deno, ["fmt", "--no-config", "--check", "-"], {
			env: { ...env, DENO_NO_PACKAGE_JSON: "1" },
			stdio: ["pipe", "ignore", "pipe"],
		});
		let stderr = "";
		let settled = false;
		const finish = (diagnostic?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(diagnostic);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish();
		}, DIAGNOSTIC_TIMEOUT_MS);
		timer.unref?.();
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length >= MAX_DIAGNOSTIC_CHARS) return;
			stderr += chunk.toString().slice(0, MAX_DIAGNOSTIC_CHARS - stderr.length);
		});
		child.once("error", () => finish());
		child.once("close", (code) =>
			finish(code === 0 ? undefined : extractDenoSyntaxError(stderr))
		);
		child.stdin?.on("error", () => undefined);
		child.stdin?.end(source);
	});
}

export function extractDenoSyntaxError(stderr: string): string | undefined {
	const clean = stderr.replace(/\u001b\[[0-9;]*m/g, "").replaceAll("file:///_stdin.ts", "notebook cell");
	const marker = "error: SyntaxError:";
	const start = clean.indexOf(marker);
	if (start === -1) return undefined;
	return clean.slice(start + "error: ".length).trim().slice(0, MAX_DIAGNOSTIC_CHARS);
}
