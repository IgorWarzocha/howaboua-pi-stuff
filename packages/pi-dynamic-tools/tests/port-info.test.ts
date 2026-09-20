import { describe, expect, test } from "bun:test";
import {
	decodeProcAddress,
	parseLsof,
	parsePort,
	parseProcNet,
} from "../examples/port-info/port-info.mjs";

describe("bundled port_info parsers", () => {
	test("validates the one-word port input", () => {
		expect(parsePort("3000")).toBe(3000);
		expect(() => parsePort("tcp:3000")).toThrow("input must be a port number");
		expect(() => parsePort("70000")).toThrow(
			"port must be between 1 and 65535",
		);
	});

	test("parses Linux socket tables and addresses", () => {
		const table = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345`;
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
		const rows = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 2147483647 alice 20u IPv4 0x123 0t0 TCP 127.0.0.1:3000 (LISTEN)`;
		expect(parseLsof(rows)[0]).toMatchObject({
			protocol: "tcp4",
			local_address: "127.0.0.1",
			local_port: 3000,
			remote_address: null,
			remote_port: null,
			state: "listen",
			owners: [{ pid: 2147483647, user: "alice", command: "node" }],
		});
	});
});
