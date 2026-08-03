import type { Server as HttpsServer } from "node:https";

export async function collectFailures(promises: ReadonlyArray<Promise<unknown> | undefined>, failures: unknown[]): Promise<void> {
	const settled = await Promise.allSettled(promises.filter((promise): promise is Promise<unknown> => promise !== undefined));
	for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
}

export function configureServer(server: HttpsServer): void {
	server.keepAliveTimeout = 20_000;
	server.on("tlsClientError", () => {});
	server.on("clientError", (_error, socket) => socket.destroy());
	server.on("error", () => {});
}

export function listen(server: HttpsServer, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
		const onListening = () => { server.off("error", onError); resolve(); };
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "0.0.0.0");
	});
}

export function lanVoiceUrls(hostnames: string[], ipAddresses: string[], port: number): string[] {
	const hosts = [...hostnames.filter((value) => value !== "localhost"), ...ipAddresses.filter((value) => value !== "127.0.0.1")];
	if (hosts.length === 0) hosts.push("localhost");
	return [...new Set(hosts.map((host) => `https://${host}:${port}`))];
}
