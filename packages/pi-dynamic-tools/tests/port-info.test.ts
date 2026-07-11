import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import {
	buildPortReport,
	decodeProcAddress,
	parseLsof,
	parsePort,
	parseProcNet,
} from "../examples/port-info/port-info.mjs";
import { parseDynamicTool } from "../src/config.js";

describe("bundled port_info example", () => {
	let server: Server;
	let port: number;

	beforeAll(async () => {
		server = createServer();
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("missing test port");
		port = address.port;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	test("validates the one-word port input", () => {
		expect(parsePort("3000")).toBe(3000);
		expect(() => parsePort("tcp:3000")).toThrow("input must be a port number");
		expect(() => parsePort("70000")).toThrow(
			"port must be between 1 and 65535",
		);
	});

	test("parses Linux socket tables and addresses", () => {
		const table = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345`;
		expect(parseProcNet(table, "tcp4")).toEqual([
			{
				protocol: "tcp4",
				local_address: "127.0.0.1",
				local_port: 3000,
				remote_address: null,
				remote_port: null,
				state: "listen",
				uid: 1000,
				inode: "12345",
			},
		]);
		expect(decodeProcAddress("00000000000000000000000001000000")).toBe("::1");
	});

	test("normalizes lsof output", () => {
		const rows = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 4321 alice 20u IPv4 0x123 0t0 TCP 127.0.0.1:3000 (LISTEN)`;
		const [endpoint] = parseLsof(rows);
		expect(endpoint).toMatchObject({
			protocol: "tcp4",
			local_address: "127.0.0.1",
			local_port: 3000,
			remote_address: null,
			remote_port: null,
			state: "listen",
			owners: [{ pid: 4321, user: "alice", command: "node" }],
		});
	});

	test("runs through the shipped TOML definition", () => {
		if (process.platform !== "linux") return;
		const definitionPath = fileURLToPath(
			new URL("../examples/port_info.toml", import.meta.url),
		);
		const tool = parseDynamicTool(
			definitionPath,
			readFileSync(definitionPath, "utf8"),
		);
		const output = execFileSync(tool.command, [...tool.args, String(port)], {
			encoding: "utf8",
		});
		const report = JSON.parse(output);
		expect(report.listeners).toEqual(
			expect.arrayContaining([expect.objectContaining({ local_port: port })]),
		);
	});

	test("finds a live local listener on Linux", () => {
		if (process.platform !== "linux") return;
		const report = buildPortReport(port);
		const listener = report.listeners.find(
			(entry: { local_port?: number }) => entry.local_port === port,
		);
		expect(listener).toBeDefined();
		expect(listener.owners).toEqual(
			expect.arrayContaining([expect.objectContaining({ pid: process.pid })]),
		);
	});
});
