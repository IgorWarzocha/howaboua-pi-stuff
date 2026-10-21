import type { IncomingMessage, ServerResponse } from "node:http";
import type { Worker } from "node:worker_threads";
import type { CustomTabs } from "./custom-tabs/index.ts";

export type MonitorMode = "paused" | "catch-up" | "live";
export interface MonitorStatus {
	mode: MonitorMode;
	busy: boolean;
	revision: number;
}

/** Launches catch up once. Browsing and status polling never start work. */
export function createMonitor(writer: Worker, tabs: CustomTabs) {
	let mode: MonitorMode = "paused";
	let generation = 0;
	let revision = -1;
	let indexBusy = false;
	let tabsBusy = false;
	let transition = Promise.resolve();
	function settle(): void {
		if (mode === "catch-up" && !indexBusy && !tabsBusy) mode = "paused";
	}
	writer.on(
		"message",
		(message: { generation: number; busy: boolean; revision: number }) => {
			revision = message.revision;
			if (message.generation !== generation) return;
			indexBusy = message.busy;
			settle();
		},
	);
	function select(next: MonitorMode): void {
		if (next === mode) return;
		mode = next;
		const run = ++generation;
		indexBusy = true;
		tabsBusy = true;
		writer.postMessage({ mode, generation });
		const paused = tabs.pause();
		transition = transition.then(async () => {
			await paused;
			if (run !== generation) return;
			if (next === "live") tabs.start();
			else if (next === "catch-up") await tabs.once();
			if (run !== generation) return;
			tabsBusy = false;
			settle();
		});
	}
	return {
		updateOnce(): void {
			if (mode === "paused") select("catch-up");
		},
		serve(
			request: IncomingMessage,
			url: URL,
			response: ServerResponse,
		): boolean {
			if (url.pathname !== "/api/monitor") return false;
			if (request.method === "POST") {
				request.resume();
				const next = url.searchParams.get("mode");
				if (next !== "paused" && next !== "catch-up" && next !== "live") {
					response.writeHead(400).end("Choose paused, catch-up or live.");
					return true;
				}
				select(next);
			} else if (request.method !== "GET") {
				response.writeHead(405, { Allow: "GET, POST" }).end();
				return true;
			}
			const status: MonitorStatus = {
				mode,
				busy: indexBusy || tabsBusy,
				revision,
			};
			response
				.writeHead(200, { "Content-Type": "application/json" })
				.end(JSON.stringify(status));
			return true;
		},
		async close() {
			generation++;
			await tabs.pause();
			await transition;
		},
	};
}
