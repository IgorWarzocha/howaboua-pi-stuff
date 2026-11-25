import type { ChildProcessByStdio } from "node:child_process";
import { createServer, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";

/** Adapt the owned compiler's separate stdio streams to the public tsrs socket client. */
export function bridgeCompilerStdio(
	child: ChildProcessByStdio<Writable, Readable, null>,
	pipe: string,
) {
	const { stdin, stdout } = child;
	let socket: Socket | undefined;
	const server = createServer((connection) => {
		if (socket || child.exitCode !== null || child.signalCode !== null) {
			connection.destroy();
			return;
		}
		socket = connection;
		connection.on("error", () => connection.destroy());
		connection.once("close", () => {
			connection.unpipe(stdin);
			stdout.unpipe(connection);
			stdin.end();
		});
		connection.pipe(stdin);
		stdout.pipe(connection);
	});
	const close = () => {
		socket?.destroy();
		if (server.listening) server.close();
	};
	child.once("close", close);
	stdin.on("error", close);
	stdout.on("error", close);
	return {
		listen: () =>
			new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(pipe, () => resolve());
			}),
		close,
	};
}
