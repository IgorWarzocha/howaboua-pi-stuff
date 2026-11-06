// Core owns this private terminal. Nothing touches stdout before attachment.
const bootstrap = JSON.parse(Buffer.from(process.argv[1], "base64").toString());
const { focusWire } = await import(bootstrap.wire);
let runtime;
let starting = false;
let stopped = false;
async function stop(error) {
	if (stopped) return;
	stopped = true;
	if (error) {
		try {
			wire.send({ type: "error", message: error.message });
		} catch {}
	}
	// Cleanup must finish before a replacement publishes the same context path.
	const deadline = setTimeout(() => process.exit(1), 2000);
	deadline.unref();
	try {
		await runtime?.close();
		try {
			wire.send({ type: "closed" });
		} catch {}
	} finally {
		wire.close();
		process.stdin.destroy();
		process.stdout.end(() => process.exit(error ? 1 : 0));
	}
}
const wire = focusWire(
	bootstrap.nonce,
	(bytes) => {
		if (process.stdout.writableLength + bytes.length > 1024 * 1024)
			throw new Error("Remote connection output exceeded its buffer");
		process.stdout.write(bytes);
	},
	(value) => {
		if (value?.type === "close") {
			void stop();
			return;
		}
		if (value?.type === "start" && !starting) {
			starting = true;
			void import(value.input.modules.helper)
				.then(async ({ serve }) => {
					runtime = await serve(
						value.input,
						(message) => wire.send(message),
						stop,
					);
					if (stopped) {
						await runtime.close();
						return;
					}
					wire.send({ type: "ready" });
				})
				.catch(stop);
		} else if (runtime) runtime.receive(value);
		else throw new Error("Remote connection is not ready");
	},
	stop,
	undefined,
	{ maxMessageBytes: 8 * 1024 * 1024, maxQueuedBytes: 24 * 1024 * 1024 },
);
process.stdin.setRawMode(true);
process.stdin.on("data", (bytes) => wire.push(bytes));
process.stdin.on("error", stop);
process.stdin.on("end", () => void stop());
process.stdout.on("error", stop);
process.on("SIGTERM", () => void stop());
process.on("SIGHUP", () => void stop());
