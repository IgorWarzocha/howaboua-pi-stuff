import test from "node:test";
import assert from "node:assert/strict";
import { formatExecBridgeExitError } from "../src/tools/exec/bridge-client.ts";

test("exec_bridge loader failures include local build guidance", () => {
	const message = formatExecBridgeExitError(
		"/path/exec_bridge: /lib/aarch64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found",
		1,
		undefined,
	);

	assert.match(message, /GLIBC_2\.39/);
	assert.match(message, /pi-codex-conversion Git checkout/);
	assert.match(message, /build:path-tool codex-exec-shim exec_bridge/);
	assert.match(message, /src\/index\.ts as the Pi extension/);
});

test("exec_bridge normal exits do not include local build guidance", () => {
	const message = formatExecBridgeExitError("", 1, undefined);

	assert.equal(message, "exec_bridge exited (code 1)");
});
