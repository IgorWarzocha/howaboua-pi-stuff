import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureCodeModeHostBinary } from "../src/tools/code-mode/binary.ts";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";
import { prepareCodeModeToolInput } from "../src/tools/code-mode/tool-input.ts";
import type { CodeModeExecutionClient } from "../src/tools/code-mode/shared-runtime.ts";
import type {
	RuntimeResponse,
	ToolExecutionContext,
} from "../src/tools/code-mode/types.ts";
import { TsCodeModeClient } from "../src/tools/ts-mode/client.ts";
import { VmCodeClient } from "../src/tools/vm-mode/client.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const CALLS = Number(process.env["BENCH_CALLS"] ?? 500);
const WARMUP = 3;
const SAMPLE_EVERY = 50;
// No top-level bindings: TS rejects a later cell that redeclares them. Every mode keeps the string through store/load.
const SOURCE = `store("held", await Promise.resolve((() => {
  var loaded = load("held");
  return typeof loaded === "string" ? loaded : "x".repeat(100000);
})()));
text(String(load("held")).length);`;
const LOOP = '// @exec: {"yield_time_ms": 200}\nwhile (true);';

interface Sample {
	call: number;
	nodeHeapMiB: number;
	rssMiB: number;
	workerHeapMiB?: number;
}
interface ModeResult {
	mode: string;
	error?: string;
	retained?: boolean;
	p50Ms?: number;
	p95Ms?: number;
	samples?: Sample[];
	recoveryMs?: number;
	recoveryError?: string;
	recoveryRestart?: boolean;
}

function executionContext(cwd: string): ToolExecutionContext {
	return {
		cwd,
		toolCallId: "bench",
		extensionContext: {
			cwd,
			sessionManager: { getSessionId: () => "bench", getBranch: () => [] },
		} as unknown as ExtensionContext,
	};
}

function textOf(response: RuntimeResponse): string {
	return response.contentItems
		.map((item) => (item.type === "input_text" ? item.text : ""))
		.join("\n");
}

function percentile(values: number[], ratio: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * ratio) - 1),
	);
	return sorted[index] ?? 0;
}

function rssBytes(pid = process.pid): number {
	const own =
		Number(
			/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ??
				0,
		) * 1024;
	let children = 0;
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
			const ppid = Number(
				stat
					.slice(stat.lastIndexOf(")") + 1)
					.trim()
					.split(" ")[1],
			);
			if (ppid === pid) children += rssBytes(Number(entry));
		} catch {
			/* process exited while scanning */
		}
	}
	return own + children;
}

async function once(
	code: CodeModeExecutionClient,
	source: string,
	cwd: string,
): Promise<RuntimeResponse> {
	return code.execute(source, executionContext(cwd));
}

async function measure(
	mode: string,
	code: CodeModeExecutionClient,
	cwd: string,
	workerHeap?: () => Promise<number | undefined>,
): Promise<ModeResult> {
	const result: ModeResult = { mode, samples: [] };
	try {
		for (let i = 0; i < WARMUP; i++) await once(code, SOURCE, cwd);
		const probe = await once(code, "text(String(load('held')).length)", cwd);
		result.retained = textOf(probe).includes("100000");
		const latencies: number[] = [];
		for (let call = 1; call <= CALLS; call++) {
			const started = performance.now();
			const response = await once(code, SOURCE, cwd);
			latencies.push(performance.now() - started);
			if (response.kind === "result" && response.errorText)
				throw new Error(response.errorText);
			if (call % SAMPLE_EVERY === 0) {
				const worker = await workerHeap?.().catch(() => undefined);
				const usage = process.memoryUsage();
				result.samples!.push({
					call,
					nodeHeapMiB: Math.round((usage.heapUsed / 1048576) * 10) / 10,
					rssMiB: Math.round((rssBytes() / 1048576) * 10) / 10,
					...(worker === undefined
						? {}
						: { workerHeapMiB: Math.round((worker / 1048576) * 10) / 10 }),
				});
			}
		}
		result.p50Ms = Math.round(percentile(latencies, 0.5) * 100) / 100;
		result.p95Ms = Math.round(percentile(latencies, 0.95) * 100) / 100;
		const started = performance.now();
		try {
			const loop = await once(code, LOOP, cwd);
			if (loop.kind === "yielded")
				await code.terminate(loop.cellId, executionContext(cwd));
			let follow = await once(code, SOURCE, cwd).catch((error) => ({
				failed: error instanceof Error ? error.message : String(error),
			}));
			const failed =
				"failed" in follow
					? follow.failed
					: follow.kind === "result"
						? follow.errorText
						: undefined;
			if (failed && code.controlNotebook) {
				await code.controlNotebook(
					{ action: "restart" },
					executionContext(cwd),
				);
				result.recoveryRestart = true;
				follow = await once(code, SOURCE, cwd);
			}
			if ("failed" in follow) result.recoveryError = follow.failed;
			else if (follow.kind === "result" && follow.errorText)
				result.recoveryError = follow.errorText;
			else if (!textOf(follow).includes("100000"))
				result.recoveryError = `follow-up output was ${textOf(follow).slice(0, 120)}`;
		} catch (error) {
			result.recoveryError =
				error instanceof Error ? error.message : String(error);
		}
		result.recoveryMs = Math.round(performance.now() - started);
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	} finally {
		await code.shutdown().catch(() => undefined);
	}
	return result;
}

async function openMode(
	mode: string,
	agentDir: string,
): Promise<{
	code: CodeModeExecutionClient;
	workerHeap?: () => Promise<number | undefined>;
}> {
	const options = {
		maxHeapMiB: 256,
		agentDir,
		prepareToolInput: prepareCodeModeToolInput,
	};
	if (mode === "Code")
		return {
			code: new CodeModeHostClient({
				binary: await ensureCodeModeHostBinary(undefined, { agentDir }),
				tools: [],
			}),
		};
	if (mode === "TS") return { code: new TsCodeModeClient(options) };
	const vm = new VmCodeClient(options);
	return { code: vm, workerHeap: async () => (await vm.sample())?.heapUsed };
}

const MODES = ["Code", "TS", "VM Code"];
const requested = process.argv[2] === "--mode" ? process.argv[3] : undefined;

if (requested) {
	const cwd = process.argv[4];
	if (!cwd || !MODES.includes(requested))
		throw new Error("Usage: bench-code-modes.ts --mode <mode> <agentDir>");
	const opened = await openMode(requested, cwd);
	process.stdout.write(
		JSON.stringify(
			await measure(requested, opened.code, cwd, opened.workerHeap),
		),
	);
} else {
	const agentDir = await mkdtemp(join(tmpdir(), "code-modes-"));
	const results: ModeResult[] = [];
	try {
		for (const mode of MODES) {
			process.stderr.write(`measuring ${mode}\n`);
			results.push(await runMode(mode, agentDir));
		}
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
	printResults(results);
}

function runMode(mode: string, agentDir: string): Promise<ModeResult> {
	const script = fileURLToPath(import.meta.url);
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[...process.execArgv, script, "--mode", mode, agentDir],
			{ stdio: ["ignore", "pipe", "inherit"] },
		);
		let out = "";
		child.stdout.on("data", (chunk) => {
			out += String(chunk);
		});
		child.on("close", (code) => {
			const start = out.indexOf("{");
			const end = out.lastIndexOf("}");
			try {
				resolve(JSON.parse(out.slice(start, end + 1)) as ModeResult);
			} catch {
				resolve({ mode, error: out.trim() || `exited ${code}` });
			}
		});
	});
}

function printResults(results: ModeResult[]): void {
	console.log(
		"mode | retained 100KB | p50 ms | p95 ms | recovery ms | node heap/worker heap/rss MiB every 50",
	);
	for (const result of results) {
		if (result.error) {
			console.log(`${result.mode} | failed | ${result.error}`);
			continue;
		}
		const memory = (result.samples ?? [])
			.map(
				(sample) =>
					`${sample.call}:${sample.nodeHeapMiB}/${sample.workerHeapMiB ?? "-"}/${sample.rssMiB}`,
			)
			.join(" ");
		console.log(
			`${result.mode} | ${result.retained ? "yes" : "no"} | ${result.p50Ms} | ${result.p95Ms} | ${result.recoveryMs}${result.recoveryRestart ? " restart" : ""}${result.recoveryError ? ` (${result.recoveryError})` : ""} | ${memory}`,
		);
	}
	console.log(`BENCH_JSON ${JSON.stringify(results)}`);
}
