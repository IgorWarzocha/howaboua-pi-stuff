import { chmodSync, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LanVoiceDiagnostics {
	readonly path: string;
	write(source: "browser" | "server" | "realtime" | "dictation", event: string, data?: unknown): void;
	close(): Promise<void>;
}

export function createLanVoiceDiagnostics(agentDir: string): LanVoiceDiagnostics {
	const directory = join(agentDir, "lan-voice");
	const path = join(directory, "debug.jsonl");
	const startedAt = Date.now();
	let sequence = 0;
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	writeFileSync(path, "", { mode: 0o600 });
	chmodSync(path, 0o600);
	const stream = createWriteStream(path, { flags: "a", mode: 0o600 });
	stream.on("error", () => {});

	return {
		path,
		write(source, event, data) {
			try {
				stream.write(`${JSON.stringify({
					sequence: ++sequence,
					timestamp: new Date().toISOString(),
					elapsedMs: Date.now() - startedAt,
					source,
					event,
					...(data === undefined ? {} : { data }),
				}, jsonValue)}\n`);
			} catch {
				// Diagnostics must not alter the voice path they observe.
			}
		},
		close() {
			return new Promise((resolve) => stream.end(resolve));
		},
	};
}

function jsonValue(_key: string, value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
			...(value.cause === undefined ? {} : { cause: value.cause }),
		};
	}
	if (typeof value === "bigint") return value.toString();
	return value;
}
