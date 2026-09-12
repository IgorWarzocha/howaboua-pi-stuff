import { spawn } from "node:child_process";

const DIAGNOSTIC_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_CHARS = 8_192;

type SyntaxCheck =
	| { status: "parsed" }
	| { status: "error"; diagnostic: string }
	| { status: "unavailable" };

export async function diagnoseDenoSyntax(
	deno: string,
	source: string,
	env: NodeJS.ProcessEnv,
	cellSource?: string,
): Promise<string | undefined> {
	if (cellSource !== undefined) {
		const cell = await checkDenoSyntax(deno, cellSource, env, "notebook cell");
		if (cell.status === "error") return cell.diagnostic;
		if (cell.status === "unavailable") return undefined;
	}
	const generated = await checkDenoSyntax(deno, source, env, "generated notebook code");
	return generated.status === "error" ? generated.diagnostic : undefined;
}

function checkDenoSyntax(
	deno: string,
	source: string,
	env: NodeJS.ProcessEnv,
	sourceLabel: string,
): Promise<SyntaxCheck> {
	return new Promise((resolve) => {
		const child = spawn(deno, ["fmt", "--no-config", "--check", "-"], {
			env: { ...env, DENO_NO_PACKAGE_JSON: "1" },
			stdio: ["pipe", "ignore", "pipe"],
		});
		let stderr = "";
		let settled = false;
		const finish = (result: SyntaxCheck = { status: "unavailable" }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
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
		child.once("close", (code) => {
			const diagnostic = extractDenoSyntaxError(stderr, sourceLabel);
			finish(code === 0 ? { status: "parsed" }
				: diagnostic ? { status: "error", diagnostic } : { status: "unavailable" });
		});
		child.stdin?.on("error", () => undefined);
		child.stdin?.end(source);
	});
}

export function extractDenoSyntaxError(stderr: string, sourceLabel = "notebook cell"): string | undefined {
	const clean = stderr.replace(/\u001b\[[0-9;]*m/g, "").replace(
		/^(\s*at )file:\/\/[^\r\n]*\/_stdin\.ts(?=:\d+:\d+\s*$)/gm,
		`$1${sourceLabel}`,
	);
	const marker = "error: SyntaxError:";
	const start = clean.indexOf(marker);
	if (start === -1) return undefined;
	return clean.slice(start + "error: ".length).trim().slice(0, MAX_DIAGNOSTIC_CHARS);
}
