import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { VM } from "@earendil-works/gondolin";
import { z } from "zod";
import { checked, guestExists } from "./guest.ts";
import { shellQuote as q } from "./storage.ts";

const root = "/var/lib/pi-sandbox/commands";
const outcome = z.strictObject({
	exitCode: z.number().int(),
	truncated: z.boolean(),
});
const worker = [
	"import ctypes,json,os,select,signal,subprocess,sys,time",
	"cmd,cwd,path,cleanup,deadline=sys.argv[1:]",
	"cleanup=cleanup=='true'",
	"if cleanup: ctypes.CDLL(None).prctl(36,1,0,0,0)",
	"try: p=subprocess.Popen(['/bin/sh','-lc',cmd],cwd=cwd,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)",
	"except Exception as e:",
	" open(path+'/output','wb').write(str(e).encode()[:65536]); open(path+'/done.tmp','w').write(json.dumps({'exitCode':127,'truncated':False})); os.rename(path+'/done.tmp',path+'/done'); sys.exit(0)",
	"open(path+'/pid.tmp','w').write(str(p.pid)); os.rename(path+'/pid.tmp',path+'/pid')",
	"os.set_blocking(p.stdout.fileno(),False)",
	"size=0; truncated=False; started=time.monotonic(); expired=False; killed=None",
	"with open(path+'/output','wb',buffering=0) as out:",
	" while True:",
	"  select.select([p.stdout],[],[],0.05)",
	"  try: data=os.read(p.stdout.fileno(),65536)",
	"  except BlockingIOError: data=b''",
	"  if not data: time.sleep(0.05)",
	"  if data:",
	"   room=max(0,65536-size); out.write(data[:room]); size+=min(room,len(data)); truncated=truncated or len(data)>room",
	"   if truncated and not os.path.exists(path+'/truncated'): open(path+'/truncated','w').close()",
	"  if killed is None and os.path.exists(path+'/kill'):",
	"   killed=time.monotonic()",
	"   try: os.killpg(p.pid,signal.SIGTERM)",
	"   except ProcessLookupError: pass",
	"  if killed is not None and time.monotonic()-killed>=2:",
	"   try: os.killpg(p.pid,signal.SIGKILL)",
	"   except ProcessLookupError: pass",
	"  if float(deadline)>0 and time.monotonic()-started>float(deadline):",
	"   expired=True",
	"   try: os.killpg(p.pid,signal.SIGKILL)",
	"   except ProcessLookupError: pass",
	"   break",
	"  if p.poll() is not None and (cleanup or not data) and (killed is None or time.monotonic()-killed>=2): break",
	"if cleanup:",
	" while True:",
	"  children=[]",
	"  for name in os.listdir('/proc'):",
	"   if not name.isdigit(): continue",
	"   try:",
	"    fields=open('/proc/'+name+'/stat').read().rsplit(')',1)[1].split()",
	"    if int(fields[1])==os.getpid(): children.append(int(name))",
	"   except (OSError,ValueError): pass",
	"  if not children: break",
	"  for child in children:",
	"   try: os.kill(child,signal.SIGKILL)",
	"   except ProcessLookupError: pass",
	"  while True:",
	"   try:",
	"    if os.waitpid(-1,os.WNOHANG)[0]==0: break",
	"   except ChildProcessError: break",
	"  time.sleep(0.01)",
	"p.wait()",
	"with open(path+'/output','ab',buffering=0) as out:",
	" for attempt in range(4):",
	"  try: data=os.read(p.stdout.fileno(),65536)",
	"  except BlockingIOError: break",
	"  if not data: break",
	"  room=max(0,65536-size); out.write(data[:room]); size+=min(room,len(data)); truncated=truncated or len(data)>room",
	"p.stdout.close()",
	"code=124 if expired else (p.returncode if p.returncode>=0 else 128-p.returncode)",
	"open(path+'/done.tmp','w').write(json.dumps({'exitCode':code,'truncated':truncated}))",
	"os.rename(path+'/done.tmp',path+'/done')",
].join("\n");

// Only the short launcher is SDK-tracked. Long waits never hold Gondolin's
// foreground exec/file-RPC lock. Handles belong to this controller lifetime.
export class GuestProcesses {
	private commands = new Map<
		number,
		{
			path: string;
			offset: number;
			decoder: StringDecoder;
		}
	>();
	private vm: VM;
	constructor(vm: VM) {
		this.vm = vm;
	}
	async launch(
		cmd: string,
		cwd: string,
		cleanup = false,
		deadlineSeconds = 0,
	): Promise<number> {
		const path = `${root}/${randomUUID()}`;
		await checked(this.vm, `mkdir -p ${q(path)}; chmod 700 ${q(path)}`);
		await this.vm.fs.writeFile(`${path}/worker.py`, worker);
		await checked(
			this.vm,
			`python3 -c ${q("import subprocess,sys; subprocess.Popen(sys.argv[1:],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)")} python3 ${q(`${path}/worker.py`)} ${q(cmd)} ${q(cwd)} ${q(path)} ${q(String(cleanup))} ${q(String(deadlineSeconds))}`,
		);
		const deadline = Date.now() + 5000;
		while (!(await guestExists(this.vm, `${path}/pid`))) {
			if (await guestExists(this.vm, `${path}/done`))
				throw new Error(
					`Guest command could not start: ${await this.vm.fs.readFile(`${path}/output`, { encoding: "utf8" })}`,
				);
			if (Date.now() >= deadline)
				throw new Error(
					"Guest command did not start. Check its working directory and image Python installation",
				);
			await new Promise((accept) => setTimeout(accept, 50));
		}
		const pid = z
			.number()
			.int()
			.positive()
			.parse(
				Number(await this.vm.fs.readFile(`${path}/pid`, { encoding: "utf8" })),
			);
		this.commands.set(pid, {
			path,
			offset: 0,
			decoder: new StringDecoder("utf8"),
		});
		return pid;
	}
	async status(
		pid: number,
		timeoutMs: number,
	): Promise<{
		pid: number;
		running: boolean;
		output: string;
		exitCode?: number;
		truncated?: boolean;
	}> {
		const command = this.commands.get(pid);
		if (!command)
			throw new Error(
				"Unknown command handle. Handles do not survive stop or controller restart",
			);
		// Waits are independent. Cursor consumption below is synchronous after
		// each read, so concurrent status requests cannot replay prior output.
		const read = async () => {
			const deadline = Date.now() + timeoutMs;
			let done: z.infer<typeof outcome> | undefined;
			while (true) {
				if (await guestExists(this.vm, `${command.path}/done`)) {
					done = outcome.parse(
						JSON.parse(
							await this.vm.fs.readFile(`${command.path}/done`, {
								encoding: "utf8",
							}),
						),
					);
					break;
				}
				if (Date.now() >= deadline) break;
				await new Promise((accept) => setTimeout(accept, 100));
			}
			const bytes = (await guestExists(this.vm, `${command.path}/output`))
				? Buffer.from(await this.vm.fs.readFile(`${command.path}/output`))
				: Buffer.alloc(0);
			let output =
				bytes.length > command.offset
					? command.decoder.write(bytes.subarray(command.offset))
					: "";
			command.offset = Math.max(command.offset, bytes.length);
			if (done) output += command.decoder.end();
			return {
				pid,
				running: !done,
				output,
				truncated:
					done?.truncated ??
					(await guestExists(this.vm, `${command.path}/truncated`)),
				...(done ?? {}),
			};
		};
		return read();
	}
	async kill(pid: number): Promise<unknown> {
		const command = this.commands.get(pid);
		if (!command)
			throw new Error("Unknown command handle. Use the pid returned by exec");
		await this.vm.fs.writeFile(`${command.path}/kill`, "kill\n");
		// Kill must not wait behind a concurrent status cursor.
		return { pid, killRequested: true };
	}
}
