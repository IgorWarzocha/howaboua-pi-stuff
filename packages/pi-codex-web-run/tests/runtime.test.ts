import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { fetchCodexTool } from "../src/codex-runtime/http.js";

test("redirects strip cross-origin credentials and recompute proxy routing", async () => {
	const requests: string[] = [];
	const server = createServer((req, res) => {
		requests.push(`${req.url}:${req.headers.authorization ?? "none"}`);
		if (req.url === "/start") {
			res.writeHead(307, {
				location: `http://localhost:${(server.address() as { port: number }).port}/done`,
			});
			res.end();
		} else res.end("routed");
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	let proxyRequests = 0;
	const proxy = createServer((req, res) => {
		proxyRequests++;
		const upstream = request(
			req.url!,
			{ method: req.method, headers: req.headers },
			(response) => {
				res.writeHead(response.statusCode!, response.headers);
				response.pipe(res);
			},
		);
		upstream.on("error", (error) => res.destroy(error));
		req.pipe(upstream);
	});
	await new Promise<void>((resolve) => proxy.listen(0, resolve));
	const previous = {
		http_proxy: process.env["http_proxy"],
		no_proxy: process.env["no_proxy"],
	};
	process.env["http_proxy"] =
		`http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
	process.env["no_proxy"] = "localhost";
	try {
		const response = await fetchCodexTool(
			`http://127.0.0.1:${(server.address() as { port: number }).port}/start`,
			{
				headers: new Headers({ authorization: "secret" }),
				signal: AbortSignal.timeout(3000),
			},
		);
		assert.equal(response.text, "routed");
		assert.deepEqual(requests, ["/start:secret", "/done:none"]);
		assert.equal(proxyRequests, 1);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		server.closeAllConnections();
		proxy.closeAllConnections();
		await Promise.all([
			new Promise<void>((resolve) => server.close(() => resolve())),
			new Promise<void>((resolve) => proxy.close(() => resolve())),
		]);
	}
});
