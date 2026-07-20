import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Message, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	DISABLED_ENV,
	HARDENING_PROMPT_PATH,
	ROLE_ENV,
	WORKER_ROLE,
} from "./constants.js";
import type { WorkerRunDetails } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(execName)
		? { command: "pi", args }
		: { command: process.execPath, args };
}

export function getFinalOutput(messages: Message[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}

export async function runHardeningWorker(options: {
	task: string;
	cwd: string;
	model: string;
	thinking: ModelThinkingLevel;
	projectTrusted: boolean;
	signal?: AbortSignal;
}): Promise<WorkerRunDetails> {
	const details: WorkerRunDetails = {
		messages: [],
		stderr: "",
		exitCode: 0,
		model: options.model,
		thinking: options.thinking,
	};
	const args = [
		"--mode",
		"json",
		"--print",
		"--no-session",
		"--model",
		options.model,
		"--thinking",
		options.thinking,
		"--append-system-prompt",
		HARDENING_PROMPT_PATH,
		options.projectTrusted ? "--approve" : "--no-approve",
		options.task,
	];
	const invocation = getPiInvocation(args);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		[ROLE_ENV]: WORKER_ROLE,
	};
	delete env[DISABLED_ENV];

	let stdoutBuffer = "";
	const decoder = new StringDecoder("utf8");
	const proc = spawn(invocation.command, invocation.args, {
		cwd: options.cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
		env,
	});

	const handleLine = (line: string) => {
		if (!line.trim()) return;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (
			!isRecord(event) ||
			event["type"] !== "message_end" ||
			!isRecord(event["message"])
		)
			return;
		const message = event["message"] as unknown as Message;
		details.messages.push(message);
		if (message.role !== "assistant") return;
		if (message.stopReason) details.stopReason = message.stopReason;
		if (message.errorMessage) details.errorMessage = message.errorMessage;
	};

	proc.stdout.on("data", (chunk: Buffer) => {
		stdoutBuffer += decoder.write(chunk);
		const lines = stdoutBuffer.split("\n");
		stdoutBuffer = lines.pop() ?? "";
		for (const line of lines)
			handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	});
	proc.stdout.on("end", () => {
		stdoutBuffer += decoder.end();
	});
	proc.stderr.on("data", (chunk: Buffer) => {
		details.stderr += chunk.toString();
	});

	let aborted = false;
	const abortProcess = () => {
		aborted = true;
		proc.kill("SIGTERM");
	};
	options.signal?.addEventListener("abort", abortProcess, { once: true });

	try {
		details.exitCode = await new Promise<number>((resolve, reject) => {
			proc.once("error", reject);
			proc.once("close", (code) => resolve(code ?? 0));
		});
	} finally {
		options.signal?.removeEventListener("abort", abortProcess);
	}
	if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
	if (aborted) throw new Error("Hardening worker aborted.");
	if (details.exitCode !== 0) {
		throw new Error(
			details.errorMessage ||
				details.stderr.trim() ||
				`Hardening worker exited with code ${details.exitCode}.`,
		);
	}
	return details;
}
