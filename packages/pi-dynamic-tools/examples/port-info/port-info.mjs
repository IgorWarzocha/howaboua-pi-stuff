#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ENDPOINTS = 25;
const MAX_STRING_CHARS = 512;
const TCP_STATES = {
	"01": "established",
	"02": "syn_sent",
	"03": "syn_received",
	"04": "fin_wait_1",
	"05": "fin_wait_2",
	"06": "time_wait",
	"07": "closed",
	"08": "close_wait",
	"09": "last_ack",
	"0A": "listen",
	"0B": "closing",
	"0C": "new_syn_received",
};

export function parsePort(input) {
	const value = input.trim();
	if (!/^\d+$/.test(value)) throw new Error("input must be a port number");
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
		throw new Error("port must be between 1 and 65535");
	return port;
}

function reverseBytes(hex) {
	return hex.match(/../g)?.reverse().join("") ?? hex;
}

function compressIpv6(groups) {
	let bestStart = -1;
	let bestLength = 0;
	for (let index = 0; index < groups.length; ) {
		if (groups[index] !== "0") {
			index++;
			continue;
		}
		let end = index;
		while (end < groups.length && groups[end] === "0") end++;
		if (end - index > bestLength) {
			bestStart = index;
			bestLength = end - index;
		}
		index = end;
	}
	if (bestLength < 2) return groups.join(":");
	const left = groups.slice(0, bestStart).join(":");
	const right = groups.slice(bestStart + bestLength).join(":");
	return `${left}::${right}` || "::";
}

export function decodeProcAddress(hex) {
	if (hex.length === 8) {
		return (reverseBytes(hex).match(/../g) ?? [])
			.map((byte) => Number.parseInt(byte, 16))
			.join(".");
	}
	if (hex.length === 32) {
		let networkHex = "";
		for (let index = 0; index < hex.length; index += 8)
			networkHex += reverseBytes(hex.slice(index, index + 8));
		const groups =
			networkHex
				.match(/.{4}/g)
				?.map((group) => Number.parseInt(group, 16).toString(16)) ?? [];
		return compressIpv6(groups);
	}
	return hex;
}

function parseAddress(value) {
	const separator = value.lastIndexOf(":");
	const rawAddress = value.slice(0, separator);
	const port = Number.parseInt(value.slice(separator + 1), 16);
	return {
		address: decodeProcAddress(rawAddress),
		port,
		unspecified: /^0+$/.test(rawAddress) && port === 0,
	};
}

export function parseProcNet(text, protocol) {
	const tcp = protocol.startsWith("tcp");
	return text
		.split("\n")
		.slice(1)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(/\s+/))
		.filter((parts) => parts.length > 9)
		.map((parts) => {
			const local = parseAddress(parts[1]);
			const remote = parseAddress(parts[2]);
			return {
				protocol,
				local_address: local.address,
				local_port: local.port,
				remote_address: remote.unspecified ? null : remote.address,
				remote_port: remote.unspecified ? null : remote.port,
				state: tcp
					? (TCP_STATES[parts[3]] ?? parts[3].toLowerCase())
					: parts[3] === "07"
						? "unconnected"
						: (TCP_STATES[parts[3]] ?? parts[3].toLowerCase()),
				uid: Number.parseInt(parts[7], 10),
				inode: parts[9],
			};
		});
}

function readText(path, fallback = "") {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return fallback;
	}
}

function readLink(path) {
	try {
		return readlinkSync(path);
	} catch {
		return undefined;
	}
}

function boundValue(value) {
	if (typeof value === "string")
		return value.length > MAX_STRING_CHARS
			? `${value.slice(0, MAX_STRING_CHARS)}…`
			: value;
	if (Array.isArray(value)) return value.slice(0, 8).map(boundValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, boundValue(entry)]),
		);
	return value;
}

function boundEndpoints(endpoints, diagnostics) {
	if (endpoints.length > MAX_ENDPOINTS)
		diagnostics.push(`Results truncated to ${MAX_ENDPOINTS} endpoints.`);
	return endpoints.slice(0, MAX_ENDPOINTS).map(boundValue);
}

function passwdUsers() {
	const users = new Map();
	for (const line of readText("/etc/passwd").split("\n")) {
		const fields = line.split(":");
		if (fields.length > 2) users.set(Number(fields[2]), fields[0]);
	}
	return users;
}

function statusFields(pid) {
	const fields = new Map();
	for (const line of readText(`/proc/${pid}/status`).split("\n")) {
		const separator = line.indexOf(":");
		if (separator !== -1)
			fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
	}
	return fields;
}

function cgroupAttribution(text) {
	const service = text.match(/(?:^|\/)([^/]+\.service)(?:\/|$)/m)?.[1];
	const docker = text.match(
		/(?:docker[-/])([0-9a-f]{12,64})(?:\.scope)?(?:\/|$)/im,
	)?.[1];
	const podman = text.match(
		/(?:libpod[-/])([0-9a-f]{12,64})(?:\.scope)?(?:\/|$)/im,
	)?.[1];
	if (docker) return { service, container: { runtime: "docker", id: docker } };
	if (podman) return { service, container: { runtime: "podman", id: podman } };
	return { service, container: undefined };
}

function linuxProcess(pid, users, includeParent = true) {
	const status = statusFields(pid);
	if (status.size === 0) return undefined;
	const uid = Number.parseInt(status.get("Uid")?.split(/\s+/)[0] ?? "", 10);
	const parentPid = Number.parseInt(status.get("PPid") ?? "", 10);
	const commandLine = readText(`/proc/${pid}/cmdline`)
		.split("\0")
		.filter(Boolean)
		.join(" ");
	const attribution = cgroupAttribution(readText(`/proc/${pid}/cgroup`));
	const process = {
		pid,
		user: users.get(uid) ?? (Number.isNaN(uid) ? undefined : String(uid)),
		command: commandLine || readText(`/proc/${pid}/comm`).trim() || undefined,
		executable: readLink(`/proc/${pid}/exe`),
		cwd: readLink(`/proc/${pid}/cwd`),
		parent_pid: Number.isNaN(parentPid) ? undefined : parentPid,
		service: attribution.service,
		container: attribution.container,
	};
	if (includeParent && process.parent_pid && process.parent_pid > 0) {
		const parent = linuxProcess(process.parent_pid, users, false);
		if (parent)
			process.parent = {
				pid: parent.pid,
				user: parent.user,
				command: parent.command,
				executable: parent.executable,
			};
	}
	return Object.fromEntries(
		Object.entries(process).filter(([, value]) => value !== undefined),
	);
}

function linuxSocketOwners(inodes, diagnostics) {
	const owners = new Map([...inodes].map((inode) => [inode, new Set()]));
	if (inodes.size === 0) return owners;
	let deniedProcesses = 0;
	for (const entry of readdirSync("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
		let descriptors;
		try {
			descriptors = readdirSync(`/proc/${entry.name}/fd`);
		} catch {
			deniedProcesses++;
			continue;
		}
		for (const descriptor of descriptors) {
			const target = readLink(`/proc/${entry.name}/fd/${descriptor}`);
			const inode = target?.match(/^socket:\[(\d+)\]$/)?.[1];
			if (inode && owners.has(inode)) owners.get(inode).add(Number(entry.name));
		}
	}
	if (deniedProcesses > 0)
		diagnostics.push(
			`Could not inspect file descriptors for ${deniedProcesses} process(es); some owners may be missing.`,
		);
	return owners;
}

function linuxReport(port) {
	const diagnostics = [];
	const tables = [
		["/proc/net/tcp", "tcp4"],
		["/proc/net/tcp6", "tcp6"],
		["/proc/net/udp", "udp4"],
		["/proc/net/udp6", "udp6"],
	];
	let endpoints = [];
	for (const [path, protocol] of tables) {
		if (!existsSync(path)) {
			diagnostics.push(`${path} is unavailable.`);
			continue;
		}
		endpoints.push(
			...parseProcNet(readText(path), protocol).filter(
				(entry) => entry.local_port === port,
			),
		);
	}
	const ownersByInode = linuxSocketOwners(
		new Set(endpoints.map((entry) => entry.inode)),
		diagnostics,
	);
	const users = passwdUsers();
	endpoints = endpoints.map((endpoint) => ({
		...endpoint,
		owners: [...(ownersByInode.get(endpoint.inode) ?? [])]
			.map((pid) => linuxProcess(pid, users))
			.filter(Boolean),
	}));
	endpoints = boundEndpoints(endpoints, diagnostics);
	return {
		port,
		platform: "linux",
		listeners: endpoints.filter(
			(entry) => entry.state === "listen" || entry.state === "unconnected",
		),
		connections: endpoints.filter(
			(entry) => entry.state !== "listen" && entry.state !== "unconnected",
		),
		diagnostics,
	};
}

function run(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: 10_000,
		maxBuffer: 1024 * 1024,
	});
	if (result.error)
		return { ok: false, error: result.error.message, stdout: "", stderr: "" };
	return {
		ok: result.status === 0,
		code: result.status ?? 1,
		stdout: result.stdout?.trim() ?? "",
		stderr: result.stderr?.trim() ?? "",
	};
}

function processFromPs(pid, fallback) {
	const result = run("ps", ["-p", String(pid), "-o", "ppid=,user=,command="]);
	const match = result.stdout.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/s);
	if (!match) return fallback;
	return {
		...fallback,
		parent_pid: Number(match[1]),
		user: match[2],
		command: match[3].trim(),
	};
}

function parseLsofAddress(value) {
	const separator = value.lastIndexOf(":");
	if (separator === -1) return { address: value, port: null };
	const address = value.slice(0, separator).replace(/^\[(.*)\]$/, "$1");
	const port = Number(value.slice(separator + 1));
	return { address, port: Number.isNaN(port) ? null : port };
}

export function parseLsof(text) {
	const endpoints = [];
	for (const line of text.split("\n").slice(1)) {
		const match = line.match(
			/^(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(TCP|UDP)\s+(.+)$/,
		);
		if (!match) continue;
		const name = match[7];
		const state =
			name.match(/\(([^)]+)\)\s*$/)?.[1]?.toLowerCase() ??
			(match[6] === "UDP" ? "unconnected" : "unknown");
		const connection = name.replace(/\s+\([^)]+\)\s*$/, "");
		const [localText, remoteText] = connection.split("->", 2);
		const local = parseLsofAddress(localText);
		const remote = remoteText ? parseLsofAddress(remoteText) : undefined;
		endpoints.push({
			protocol: `${match[6].toLowerCase()}${match[5].toLowerCase() === "ipv6" ? "6" : "4"}`,
			local_address: local.address,
			local_port: local.port,
			remote_address: remote?.address ?? null,
			remote_port: remote?.port ?? null,
			state,
			owners: [
				processFromPs(Number(match[2]), {
					pid: Number(match[2]),
					user: match[3],
					command: match[1],
				}),
			],
		});
	}
	return endpoints;
}

function lsofReport(port, platform) {
	const result = run("lsof", ["-nP", `-iTCP:${port}`, `-iUDP:${port}`]);
	const diagnostics = [];
	if (!result.ok && !result.stdout && (result.error || result.stderr))
		diagnostics.push(
			`lsof unavailable or failed: ${result.error ?? result.stderr ?? `exit ${result.code}`}`,
		);
	const endpoints = boundEndpoints(parseLsof(result.stdout), diagnostics);
	return {
		port,
		platform,
		listeners: endpoints.filter(
			(entry) => entry.state === "listen" || entry.protocol === "udp",
		),
		connections: endpoints.filter(
			(entry) => entry.state !== "listen" && entry.protocol !== "udp",
		),
		diagnostics,
	};
}

function windowsReport(port) {
	const script = `$ErrorActionPreference='SilentlyContinue'; $rows=@(); Get-NetTCPConnection -LocalPort ${port} | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter (\"ProcessId = \"+$_.OwningProcess); $s=Get-CimInstance Win32_Service -Filter (\"ProcessId = \"+$_.OwningProcess); $rows += [pscustomobject]@{protocol=$(if ($_.LocalAddress -like '*:*') {'tcp6'} else {'tcp4'});local_address=$_.LocalAddress;local_port=$_.LocalPort;remote_address=$_.RemoteAddress;remote_port=$_.RemotePort;state=$_.State.ToString().ToLower();owners=@([pscustomobject]@{pid=$_.OwningProcess;command=$p.CommandLine;executable=$p.ExecutablePath;parent_pid=$p.ParentProcessId;service=$s.Name})} }; Get-NetUDPEndpoint -LocalPort ${port} | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter (\"ProcessId = \"+$_.OwningProcess); $s=Get-CimInstance Win32_Service -Filter (\"ProcessId = \"+$_.OwningProcess); $rows += [pscustomobject]@{protocol=$(if ($_.LocalAddress -like '*:*') {'udp6'} else {'udp4'});local_address=$_.LocalAddress;local_port=$_.LocalPort;remote_address=$null;remote_port=$null;state='unconnected';owners=@([pscustomobject]@{pid=$_.OwningProcess;command=$p.CommandLine;executable=$p.ExecutablePath;parent_pid=$p.ParentProcessId;service=$s.Name})} }; $rows | ConvertTo-Json -Depth 6 -Compress`;
	let result = run("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		script,
	]);
	if (!result.ok && !result.stdout)
		result = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script]);
	const diagnostics = [];
	let endpoints = [];
	if (result.stdout) {
		try {
			const parsed = JSON.parse(result.stdout);
			endpoints = Array.isArray(parsed) ? parsed : [parsed];
		} catch (error) {
			diagnostics.push(
				`Could not parse PowerShell output: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} else if (!result.ok) {
		diagnostics.push(
			`PowerShell network inspection failed: ${result.error ?? result.stderr ?? `exit ${result.code}`}`,
		);
	}
	endpoints = boundEndpoints(endpoints, diagnostics);
	return {
		port,
		platform: "win32",
		listeners: endpoints.filter(
			(entry) => entry.state === "listen" || entry.protocol === "udp",
		),
		connections: endpoints.filter(
			(entry) => entry.state !== "listen" && entry.protocol !== "udp",
		),
		diagnostics,
	};
}

export function buildPortReport(port, platform = process.platform) {
	if (platform === "linux" && existsSync("/proc/net")) return linuxReport(port);
	if (platform === "win32") return windowsReport(port);
	return lsofReport(port, platform);
}

export function main() {
	const port = parsePort(process.argv[2] ?? "");
	process.stdout.write(`${JSON.stringify(buildPortReport(port), null, 2)}\n`);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		main();
	} catch (error) {
		process.stderr.write(
			`port_info: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
}
