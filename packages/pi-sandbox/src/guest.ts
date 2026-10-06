import { Writable } from "node:stream";
import type { VM } from "@earendil-works/gondolin";
import { commandOutcomeSchema, type Service } from "./contracts.ts";
import { shellQuote as q } from "./storage.ts";

export async function execute(
	vm: VM,
	cmd: string,
	cwd: string,
	timeoutMs: number,
): Promise<{ exitCode: number; output: string; truncated: boolean }> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	let truncated = false;
	const sink = new Writable({
		write(chunk: Buffer, _encoding, done) {
			const room = 65536 - bytes;
			if (chunk.length > room) truncated = true;
			if (room > 0) {
				const part = chunk.subarray(0, room);
				chunks.push(part);
				bytes += part.length;
			}
			done();
		},
	});
	// SDK AbortSignal stops the host wait, not the guest process. The guest
	// watchdog owns a separate process group and terminates it on timeout.
	const watchdog = [
		"import json,os,signal,subprocess,sys,time",
		"p=subprocess.Popen(['/bin/sh','-lc',sys.argv[1]],start_new_session=True,stderr=subprocess.STDOUT)",
		"try:",
		" code=p.wait(timeout=float(sys.argv[2]))",
		" result={'state':'exited','exitCode':code if code>=0 else 128-code}",
		"except subprocess.TimeoutExpired:",
		" try: os.killpg(p.pid,signal.SIGTERM)",
		" except ProcessLookupError: pass",
		" time.sleep(2)",
		" try: os.killpg(p.pid,signal.SIGKILL)",
		" except ProcessLookupError: pass",
		" p.wait()",
		" result={'state':'timed-out'}",
		"sys.stderr.write(json.dumps(result))",
	].join("\n");
	const result = await vm.exec(
		["python3", "-c", watchdog, cmd, String(timeoutMs / 1000)],
		{
			cwd,
			signal: AbortSignal.timeout(timeoutMs + 10000),
			stdout: sink,
			stderr: "buffer",
		},
	);
	const output = Buffer.concat(chunks).toString("utf8");
	if (result.exitCode !== 0)
		throw new Error(
			"Guest command could not start. Check cwd and that the image includes Python 3",
		);
	const outcome = commandOutcomeSchema.parse(JSON.parse(result.stderr));
	if (outcome.state === "timed-out")
		throw new Error(
			`Guest command timed out after ${timeoutMs} ms. Its process group was stopped. Inspect files before retrying`,
		);
	return { exitCode: outcome.exitCode, output, truncated };
}
export async function checked(
	vm: VM,
	cmd: string,
	cwd = "/",
	timeoutMs = 30000,
): Promise<string> {
	const result = await execute(vm, cmd, cwd, timeoutMs);
	if (result.exitCode !== 0)
		throw new Error(
			`Guest command exited ${result.exitCode}: ${result.output}`,
		);
	return result.output;
}
export async function guestExists(vm: VM, path: string): Promise<boolean> {
	return (await execute(vm, `test -e ${q(path)}`, "/", 3000)).exitCode === 0;
}
export const serviceRoot = "/var/lib/pi-sandbox/services";
export async function serviceRunning(vm: VM, name: string): Promise<boolean> {
	const result = await execute(
		vm,
		`test -f ${q(`${serviceRoot}/${name}.pid`)} && kill -0 "$(cat ${q(`${serviceRoot}/${name}.pid`)})" 2>/dev/null`,
		"/",
		3000,
	);
	return result.exitCode === 0;
}
export async function stopService(vm: VM, name: string): Promise<void> {
	const path = `${serviceRoot}/${name}.pid`;
	await checked(
		vm,
		`if test -f ${q(path)}; then
pid=$(cat ${q(path)})
case "$pid" in ''|*[!0-9]*) echo 'Invalid service process identity'; exit 1;; esac
if test -d "/proc/$pid" && ! tr '\\000' '\\n' < "/proc/$pid/cmdline" | grep -Fx ${q(`${serviceRoot}/${name}.sh`)} >/dev/null; then
  rm -f ${q(path)}; exit 0
fi
kill -TERM -- "-$pid" 2>/dev/null || true
attempt=0
while kill -0 -- "-$pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if test "$attempt" -ge 20; then kill -KILL -- "-$pid" 2>/dev/null || true; break; fi
  sleep 0.1
done
rm -f ${q(path)}
fi`,
	);
}
export async function startService(
	vm: VM,
	name: string,
	service: Service,
	url?: string,
): Promise<void> {
	if (await serviceRunning(vm, name)) return;
	const script = `${serviceRoot}/${name}.sh`;
	const log = `${serviceRoot}/${name}.log`;
	const environment = {
		...service.env,
		PORT: String(service.port),
		...(url ? { PUBLIC_URL: url } : {}),
	};
	const content = [
		"#!/bin/sh",
		`cd ${q(service.cwd)} || exit 1`,
		...Object.entries(environment).map(
			([key, value]) => `export ${key}=${q(value)}`,
		),
		"trap 'exit 0' TERM INT",
		"while :; do",
		`  /bin/sh -lc ${q(service.command)}`,
		"  code=$?",
		"  printf '\\nService exited %s, restarting in 1s\\n' \"$code\"",
		`  if test "$(wc -c < ${q(log)})" -gt 1048576; then mv ${q(log)} ${q(`${log}.previous`)}; exec >>${q(log)} 2>&1; fi`,
		"  sleep 1",
		"done",
		"",
	].join("\n");
	await checked(vm, `mkdir -p ${q(serviceRoot)}`);
	await vm.fs.writeFile(script, content);
	await checked(
		vm,
		`setsid /bin/sh ${q(script)} </dev/null >>${q(log)} 2>&1 & echo $! > ${q(`${serviceRoot}/${name}.pid`)}`,
	);
}
