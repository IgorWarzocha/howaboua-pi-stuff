import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { VM } from "@earendil-works/gondolin";
import { z } from "zod";
import { checked, guestExists } from "./guest.ts";
import { shellQuote as q } from "./storage.ts";

const root = "/var/lib/pi-sandbox/commands";
const completedLimit = 128;
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
		string,
		{
			path: string;
			offset: number;
			decoder: StringDecoder;
			final?: { exitCode: number; truncated: boolean };
			cursor: Promise<unknown>;
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
	): Promise<string> {
		const handle = randomUUID();
		const path = `${root}/${handle}`;
		await checked(this.vm, `mkdir -p ${q(path)}; chmod 700 ${q(path)}`);
		await this.vm.fs.writeFile(`${path}/worker.py`, worker);
		await checked(
			this.vm,
			`python3 -c ${q("import subprocess,sys; subprocess.Popen(sys.argv[1:],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)")} python3 ${q(`${path}/worker.py`)} ${q(cmd)} ${q(cwd)} ${q(path)} ${q(String(cleanup))} ${q(String(deadlineSeconds))}`,
		);
		const deadline = Date.now() + 5000;
		while (!(await guestExists(this.vm, `${path}/pid`))) {
			if (await guestExists(this.vm, `${path}/done`)) {
				const output = await this.vm.fs.readFile(`${path}/output`, {
					encoding: "utf8",
				});
				await checked(this.vm, `rm -rf ${q(path)}`);
				throw new Error(`Guest command could not start: ${output}`);
			}
			if (Date.now() >= deadline)
				throw new Error(
					"Guest command did not start. Check its working directory and image Python installation",
				);
			await new Promise((accept) => setTimeout(accept, 50));
		}
		z.number()
			.int()
			.positive()
			.parse(
				Number(await this.vm.fs.readFile(`${path}/pid`, { encoding: "utf8" })),
			);
		this.commands.set(handle, {
			path,
			offset: 0,
			decoder: new StringDecoder("utf8"),
			cursor: Promise.resolve(),
		});
		if (this.commands.size > completedLimit) {
			const completed: string[] = [];
			for (const [id, command] of this.commands)
				if (
					command.final ||
					(await guestExists(this.vm, `${command.path}/done`))
				)
					completed.push(id);
			for (const id of completed.slice(
				0,
				Math.max(0, completed.length - completedLimit),
			)) {
				const command = this.commands.get(id)!;
				await command.cursor.catch(() => {});
				await checked(this.vm, `rm -rf ${q(command.path)}`);
				this.commands.delete(id);
			}
		}
		return handle;
	}
	async status(
		pid: string,
		timeoutMs: number,
	): Promise<{
		pid: string;
		running: boolean;
		output: string;
		exitCode?: number;
		truncated?: boolean;
	}> {
		const command = this.commands.get(pid);
		if (!command)
			throw new Error(
				"Unknown or expired command handle. Completed status is bounded; handles do not survive stop or controller restart",
			);
		// Only short probes and output consumption share the cursor, never waits.
		if (command.final)
			return { pid, running: false, output: "", ...command.final };
		const deadline = Date.now() + timeoutMs;
		while (true) {
			if (this.commands.get(pid) !== command)
				throw new Error(
					"Command status expired. Completed handles retain status for 128 commands",
				);
			const probe = command.cursor
				.catch(() => {})
				.then(
					async () =>
						command.final ||
						(await guestExists(this.vm, `${command.path}/done`)),
				);
			command.cursor = probe;
			if ((await probe) || Date.now() >= deadline) break;
			await new Promise((accept) => setTimeout(accept, 100));
		}
		const consume = command.cursor
			.catch(() => {})
			.then(async () => {
				if (this.commands.get(pid) !== command)
					throw new Error(
						"Command status expired. Completed handles retain status for 128 commands",
					);
				if (command.final)
					return { pid, running: false, output: "", ...command.final };
				const done = (await guestExists(this.vm, `${command.path}/done`))
					? outcome.parse(
							JSON.parse(
								await this.vm.fs.readFile(`${command.path}/done`, {
									encoding: "utf8",
								}),
							),
						)
					: undefined;
				const bytes = (await guestExists(this.vm, `${command.path}/output`))
					? Buffer.from(await this.vm.fs.readFile(`${command.path}/output`))
					: Buffer.alloc(0);
				let output =
					bytes.length > command.offset
						? command.decoder.write(bytes.subarray(command.offset))
						: "";
				command.offset = Math.max(command.offset, bytes.length);
				if (done) {
					output += command.decoder.end();
					await checked(this.vm, `rm -rf ${q(command.path)}`);
					command.final = done;
					const completed = [...this.commands].filter(
						([, value]) => value.final,
					);
					for (const [handle] of completed.slice(
						0,
						Math.max(0, completed.length - completedLimit),
					))
						this.commands.delete(handle);
				}
				return {
					pid,
					running: !done,
					output,
					truncated:
						done?.truncated ??
						(await guestExists(this.vm, `${command.path}/truncated`)),
					...(done ?? {}),
				};
			});
		command.cursor = consume;
		return consume;
	}
	async kill(pid: string): Promise<unknown> {
		const command = this.commands.get(pid);
		if (!command)
			throw new Error("Unknown command handle. Use the pid returned by exec");
		// The cursor contains only short RPCs, never the status wait.
		const kill = command.cursor
			.catch(() => {})
			.then(async () => {
				if (command.final) return { pid, killRequested: false, running: false };
				await this.vm.fs.writeFile(`${command.path}/kill`, "kill\n");
				return { pid, killRequested: true };
			});
		command.cursor = kill;
		return kill;
	}
}
