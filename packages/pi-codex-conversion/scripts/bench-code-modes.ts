import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	codeModeHostBinaryPath,
	ensureCodeModeHostBinary,
} from "../src/tools/code-mode/binary.ts";
import { CodeModeHostClient } from "../src/tools/code-mode/host-client.ts";
import { prepareCodeModeToolInput } from "../src/tools/code-mode/tool-input.ts";
import type { CodeModeExecutionClient } from "../src/tools/execution/runtime.ts";
import type {
	ProgrammaticCodeModeToolDefinition,
	RuntimeResponse,
	ToolExecutionContext,
} from "../src/tools/code-mode/types.ts";
import { TsNotebookClient } from "../src/tools/ts-mode/client.ts";
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
const CPU_SOURCE =
	"text((() => { let sum = 0; for (let i = 0; i < 10000; i++) sum += i % 97; return sum; })());";
const CPU_EXPECTED = String(
	Array.from({ length: 10000 }, (_, i) => i % 97).reduce((a, b) => a + b, 0),
);
const HOST_SOURCE = "text(await tools.bench_double({ value: 21 }));";
async function double(input: unknown): Promise<number> {
	if (
		typeof input !== "object" ||
		input === null ||
		!("value" in input) ||
		typeof input.value !== "number"
	)
		throw new Error("Expected a numeric value");
	return input.value * 2;
}
const DOUBLE_TOOL: ProgrammaticCodeModeToolDefinition = {
	kind: "function",
	name: "bench_double",
	usage: "tools.bench_double({ value: number })",
	deferLoading: false,
	executionPipeline: "adapter",
	inputSchema: {
		type: "object",
		properties: { value: { type: "number" } },
		required: ["value"],
	},
	invoke: double,
};
type BenchmarkClient = Pick<
	CodeModeExecutionClient,
	"execute" | "controlNotebook" | "shutdown"
> &
	Partial<Pick<CodeModeExecutionClient, "terminate">>;

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
	firstCellMs?: number;
	cpuP50Ms?: number;
	cpuP95Ms?: number;
	hostP50Ms?: number;
	hostP95Ms?: number;
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
	code: BenchmarkClient,
	source: string,
	cwd: string,
): Promise<RuntimeResponse> {
	return code.execute(source, executionContext(cwd), undefined, [DOUBLE_TOOL]);
}

function assertOutput(response: RuntimeResponse, expected: string): void {
	if (response.kind !== "result")
		throw new Error("Unexpected cell status: " + response.kind);
	if (response.errorText) throw new Error(response.errorText);
	const output = textOf(response).trim();
	if (output !== expected)
		throw new Error("Expected " + expected + ", got " + output.slice(0, 120));
}

async function measure(
	mode: string,
	code: BenchmarkClient,
	cwd: string,
	openedAt: number,
	workerHeap?: () => Promise<number | undefined>,
): Promise<ModeResult> {
	const samples: Sample[] = [];
	const result: ModeResult = { mode, samples };
	try {
		const first = await once(code, SOURCE, cwd);
		result.firstCellMs = Math.round(performance.now() - openedAt);
		assertOutput(first, "100000");
		for (let i = 0; i < WARMUP; i++)
			assertOutput(await once(code, SOURCE, cwd), "100000");
		const probe = await once(code, "text(String(load('held')).length)", cwd);
		assertOutput(probe, "100000");
		result.retained = true;
		const latencies: number[] = [];
		for (let call = 1; call <= CALLS; call++) {
			const started = performance.now();
			const response = await once(code, SOURCE, cwd);
			latencies.push(performance.now() - started);
			assertOutput(response, "100000");
			if (call % SAMPLE_EVERY === 0) {
				const worker = await workerHeap?.().catch(() => undefined);
				const usage = process.memoryUsage();
				samples.push({
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
		const host = await measureCells(code, HOST_SOURCE, "42", cwd);
		const cpu = await measureCells(code, CPU_SOURCE, CPU_EXPECTED, cwd);
		result.hostP50Ms = host.p50;
		result.hostP95Ms = host.p95;
		result.cpuP50Ms = cpu.p50;
		result.cpuP95Ms = cpu.p95;
		const started = performance.now();
		try {
			const loop = await once(code, LOOP, cwd);
			if (loop.kind === "yielded" && code.terminate)
				await code.terminate(loop.cellId, executionContext(cwd));
			else if (loop.kind !== "result" || !loop.errorText)
				throw new Error("Expected loop interruption");
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
			if ("failed" in follow) throw new Error(follow.failed);
			assertOutput(follow, "100000");
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

async function measureCells(
	code: BenchmarkClient,
	source: string,
	expected: string,
	cwd: string,
) {
	for (let i = 0; i < WARMUP; i++)
		assertOutput(await once(code, source, cwd), expected);
	const latencies: number[] = [];
	for (let call = 0; call < CALLS; call++) {
		const started = performance.now();
		const response = await once(code, source, cwd);
		latencies.push(performance.now() - started);
		assertOutput(response, expected);
	}
	return {
		p50: Math.round(percentile(latencies, 0.5) * 100) / 100,
		p95: Math.round(percentile(latencies, 0.95) * 100) / 100,
	};
}

async function openMode(
	mode: string,
	agentDir: string,
): Promise<{
	code: BenchmarkClient;
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
				binary: codeModeHostBinaryPath({ agentDir }),
				tools: [],
			}),
		};
	if (mode === "TS Notebook") return { code: new TsNotebookClient(options) };
	if (mode === "PsychoScript") return { code: await openPsychoScript() };
	const vm = new VmCodeClient(options);
	return { code: vm, workerHeap: async () => vm.sampleHeapUsedBytes() };
}

async function openPsychoScript(): Promise<BenchmarkClient> {
	const { Host, Runtime } = await import("psychoscript");
	const store = new Map<string, unknown>();
	let output: string[] = [];
	const globals = () => ({
		store: Host.fn(([key, value]: readonly unknown[]) => {
			store.set(String(key), value);
		}),
		load: Host.fn(([key]: readonly unknown[]) => store.get(String(key))),
		text: Host.fn(([value]: readonly unknown[]) => {
			output.push(String(value));
		}),
		tools: {
			bench_double: Host.fn(([input]: readonly unknown[]) => double(input), {
				type: "async",
			}),
		},
	});
	const runtime = Runtime.make({ globals, limits: { timeoutMs: 5000 } });
	const recovery = Runtime.make({ globals, limits: { timeoutMs: 200 } });
	return {
		async execute(source) {
			output = [];
			const result =
				source === LOOP
					? await recovery.execute("while (true);")
					: await runtime.execute(source);
			if (
				source === LOOP &&
				(result.ok || result.error.kind !== "TimeoutExceeded")
			)
				throw new Error("PsychoScript did not time out");
			return {
				kind: "result",
				cellId: "bench",
				contentItems: output.map((text) => ({ type: "input_text", text })),
				...(result.ok ? {} : { errorText: result.error.message }),
			};
		},
		async shutdown() {
			store.clear();
		},
	};
}

const MODES = ["Code", "TS Notebook", "VM Code", "PsychoScript"];
const requested = process.argv[2] === "--mode" ? process.argv[3] : undefined;

if (requested) {
	const cwd = process.argv[4];
	if (!cwd || !MODES.includes(requested))
		throw new Error("Usage: bench-code-modes.ts --mode <mode> <agentDir>");
	// Measure first-cell startup, not downloading/installing the Code helper.
	if (requested === "Code")
		await ensureCodeModeHostBinary(undefined, { agentDir: cwd });
	const openedAt = performance.now();
	const opened = await openMode(requested, cwd);
	process.stdout.write(
		JSON.stringify(
			await measure(requested, opened.code, cwd, openedAt, opened.workerHeap),
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
		"mode | retained 100KB | first cell ms | state p50/p95 ms | host p50/p95 ms | CPU p50/p95 ms | recovery ms | state node heap/worker heap/tree RSS MiB every 50",
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
			`${result.mode} | ${result.retained ? "yes" : "no"} | ${result.firstCellMs} | ${result.p50Ms}/${result.p95Ms} | ${result.hostP50Ms}/${result.hostP95Ms} | ${result.cpuP50Ms}/${result.cpuP95Ms} | ${result.recoveryMs}${result.recoveryRestart ? " restart" : ""}${result.recoveryError ? ` (${result.recoveryError})` : ""} | ${memory}`,
		);
	}
	if (results.some(({ error, recoveryError }) => error || recoveryError))
		process.exitCode = 1;
	console.log(`BENCH_JSON ${JSON.stringify(results)}`);
}
