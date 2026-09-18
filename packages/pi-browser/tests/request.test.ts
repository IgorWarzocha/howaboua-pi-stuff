import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	defaultBrowserRouteConfig,
	readBrowserRouteConfig,
	writeBrowserRouteConfig,
} from "../src/browser/config.js";
import { remoteNodeCommand } from "../src/browser/remote.js";
import { parseBrowserRequest } from "../src/browser/request.js";
import { parseBrowserRoutes } from "../src/browser/routes.js";

test("browser requests share one validated single and batch contract", () => {
	assert.deepEqual(parseBrowserRequest("help"), { help: true });
	assert.deepEqual(parseBrowserRequest({ action: "help" }), {
		help: true,
	});
	assert.deepEqual(
		parseBrowserRequest({
			action: "tabs",
			query: "linkedin",
		}),
		{
			operations: [
				{
					action: "tabs",
					query: "linkedin",
					offset: 0,
				},
			],
		},
	);
	assert.deepEqual(
		parseBrowserRequest(
			JSON.stringify({
				response_length: "short",
				tabs: [{ query: "linkedin" }],
				open: [{ ref_id: "ABCDEF12" }],
				click: [{ ref_id: "ABCDEF12", id: 7 }],
				raw: [
					{
						ref_id: "ABCDEF12",
						method: "DOM.getDocument",
					},
				],
			}),
		),
		{
			operations: [
				{
					action: "tabs",
					query: "linkedin",
					offset: 0,
				},
				{
					action: "open",
					ref_id: "ABCDEF12",
					lineno: 1,
					response_length: "short",
				},
				{
					action: "click",
					ref_id: "ABCDEF12",
					id: 7,
				},
				{
					action: "raw",
					ref_id: "ABCDEF12",
					method: "DOM.getDocument",
					params: {},
				},
			],
		},
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				action: "open",
				ref_id: "ABCDEF12",
				url: "https://example.com",
			}),
		/exactly one/,
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				action: "click",
				ref_id: "ABCDEF12",
				id: 1,
				selector: "a",
			}),
		/exactly one/,
	);
	for (const value of ["", "  keep whitespace  ", false]) {
		const request = { action: "fill", ref_id: "ABCDEF12", id: 7, value };
		assert.deepEqual(parseBrowserRequest(request), { operations: [request] });
		assert.deepEqual(
			parseBrowserRequest({ fill: [{ ref_id: "ABCDEF12", id: 7, value }] }),
			{ operations: [request] },
		);
	}
	for (const request of [
		{ action: "fill", id: 1, selector: "input", value: "" },
		{ action: "fill", id: 1, value: 42 },
		{ action: "wait", text: "Ready", selector: ".ready" },
		{ action: "wait", text: "Ready", timeout_ms: 0 },
		{ action: "wait", text: "Ready", timeout_ms: 60_001 },
		{ action: "press", key: "Unknown+a" },
		{ action: "press", key: "constructor" },
	]) {
		assert.throws(() =>
			parseBrowserRequest({ ref_id: "ABCDEF12", ...request }),
		);
	}
	assert.deepEqual(
		parseBrowserRequest({ wait: [{ ref_id: "ABCDEF12", text: " Ready " }] }),
		{
			operations: [
				{
					action: "wait",
					ref_id: "ABCDEF12",
					text: " Ready ",
					timeout_ms: 10_000,
				},
			],
		},
	);
	assert.deepEqual(
		parseBrowserRequest({
			host: "workstation",
			tabs: [{}],
		}),
		{
			host: "workstation",
			operations: [{ action: "tabs", offset: 0 }],
		},
	);
	const routes = parseBrowserRoutes(
		{
			hosts: ["server", "laptop"],
			aliases: { "igor-server": "server" },
			remoteNodePath: "$HOME/.local/share/mise/shims/node",
		},
		"igor-server",
	);
	assert.deepEqual(routes.names, ["server", "laptop"]);
	assert.deepEqual(routes.resolve("server"), {
		name: "server",
		local: true,
	});
	const laptop = routes.resolve("laptop");
	assert.deepEqual(laptop, {
		name: "laptop",
		local: false,
		remote: {
			nodePath: "$HOME/.local/share/mise/shims/node",
		},
	});
	assert.equal(
		remoteNodeCommand(laptop.remote!),
		'$HOME/.local/share/mise/shims/node --preserve-symlinks-main "$HOME"/.pi/agent/pi-browser-worker.mjs',
	);
	assert.throws(() => routes.resolve("desktop"), /server, laptop/);
	assert.throws(
		() =>
			parseBrowserRoutes({
				hosts: ["server", "laptop"],
				aliases: { "igor-server": "server" },
				remoteNodePath: "/usr/bin/node;false",
			}),
		/unsupported shell characters/,
	);
	assert.throws(
		() =>
			parseBrowserRequest({
				response_length: "huge",
				tabs: [{}],
			}),
		/response_length/,
	);
	const directory = mkdtempSync(join(tmpdir(), "pi-browser-config-"));
	const path = join(directory, "pi-browser.json");
	try {
		writeBrowserRouteConfig(
			{
				aliases: { testbox: "server" },
				hosts: ["server", "laptop"],
				remoteNodePath: "/opt/node/bin/node",
			},
			path,
		);
		assert.deepEqual(readBrowserRouteConfig(path), {
			aliases: { testbox: "server" },
			hosts: ["server", "laptop"],
			remoteNodePath: "/opt/node/bin/node",
		});
		writeBrowserRouteConfig(defaultBrowserRouteConfig(), path);
		assert.equal(existsSync(path), false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
