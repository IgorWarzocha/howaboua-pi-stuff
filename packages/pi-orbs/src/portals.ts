import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

// Own both ends of upgraded connections. Destroying these tunnels before VM
// checkpoint keeps Gondolin's ingress close from waiting on browser WebSockets.
export async function openPortal(
	upstream: URL,
	prefix: string,
): Promise<{ url: string; close(): Promise<void> }> {
	const sockets = new Set<Duplex>();
	const server = http.createServer((incoming, response) => {
		const request = http.request(
			{
				hostname: upstream.hostname,
				port: upstream.port,
				method: incoming.method,
				path: `${prefix}${incoming.url ?? "/"}`,
				headers: incoming.headers,
			},
			(result) => {
				response.writeHead(result.statusCode ?? 502, result.headers);
				result.pipe(response);
			},
		);
		request.on("error", () => {
			if (!response.headersSent) response.writeHead(502);
			response.end("Service unavailable");
		});
		incoming.on("aborted", () => request.destroy());
		response.on("close", () => request.destroy());
		incoming.pipe(request);
	});
	const track = (socket: Duplex) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	};
	server.on("connection", track);
	server.on("upgrade", (request, socket, head) => {
		track(socket);
		const backend = net.connect(Number(upstream.port), upstream.hostname);
		track(backend);
		backend.on("connect", () => {
			backend.write(
				`${request.method ?? "GET"} ${prefix}${request.url ?? "/"} HTTP/1.1\r\n${Object.entries(
					request.headers,
				)
					.map(
						([key, value]) =>
							`${key}: ${Array.isArray(value) ? value.join(", ") : (value ?? "")}`,
					)
					.join("\r\n")}\r\n\r\n`,
			);
			if (head.length) backend.write(head);
			socket.pipe(backend).pipe(socket);
		});
		backend.on("error", () => socket.destroy());
		socket.on("error", () => backend.destroy());
		socket.on("close", () => backend.destroy());
		backend.on("close", () => socket.destroy());
	});
	await new Promise<void>((accept, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", accept);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Portal failed to bind localhost");
	let closing: Promise<void> | undefined;
	return {
		url: `http://127.0.0.1:${address.port}`,
		close() {
			if (closing) return closing;
			for (const socket of sockets) socket.destroy();
			closing = new Promise<void>((accept, reject) =>
				server.close((error) => (error ? reject(error) : accept())),
			);
			return closing;
		},
	};
}

export async function openTerminal(
	upstreamPort: number,
): Promise<{ port: number; close(): Promise<void> }> {
	const sockets = new Set<net.Socket>();
	const track = (socket: net.Socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	};
	const server = net.createServer((socket) => {
		track(socket);
		const backend = net.connect(upstreamPort, "127.0.0.1");
		track(backend);
		socket.pipe(backend).pipe(socket);
		socket.on("error", () => backend.destroy());
		backend.on("error", () => socket.destroy());
		socket.on("close", () => backend.destroy());
		backend.on("close", () => socket.destroy());
	});
	await new Promise<void>((accept, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", accept);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Guest terminal failed to bind localhost");
	let closing: Promise<void> | undefined;
	return {
		port: address.port,
		close() {
			if (closing) return closing;
			for (const socket of sockets) socket.destroy();
			closing = new Promise<void>((accept, reject) =>
				server.close((error) => (error ? reject(error) : accept())),
			);
			return closing;
		},
	};
}
