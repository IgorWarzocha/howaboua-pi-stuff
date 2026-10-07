# Pi Sandbox

Named local environments controlled from Pi, powered by [Gondolin](https://github.com/earendil-works/gondolin). Prepare a reusable environment, create independent instances, and keep a dashboard running after the controlling Pi session exits.

Use these environments for your own commands, tools, and applications. The package manages local environments and previews, not a preinstalled guest coding agent.

Special thanks to the Amp team for the inspiration, and to [Earendil](https://github.com/earendil-works) for Pi and Gondolin, the toolkit that makes this possible.

This source-only package is not published to npm or included in the aggregate Pi packages. It uses local QEMU microVMs, not Amp infrastructure. Stop saves disk state. Reopen boots a new VM and restarts services. Memory, running processes, and browser connections do not resume.

## Start an environment

Requires Node.js 24 or newer on `PATH`, QEMU and `qemu-img`, plus Linux KVM access or macOS HVF. Install those through your operating system's supported package manager. Linux x86_64 is integration-tested. macOS uses Gondolin's supported QEMU backend but has not been tested here.

```sh
# From a checkout of this repository:
bun install --frozen-lockfile
pi install ./packages/pi-sandbox
```

Guest command execution and service management require Python 3. The example below also uses Python 3 as its HTTP server. Choose Gondolin assets containing the tools your environment needs. This package ships no images or image recipes. Set `image` in the YAML to use your own Gondolin assets directory.

Create `sandbox.yaml` in your project:

```yaml
version: 1
profile: small
diskGiB: 60
workspace: /workspace
setup:
  - printf 'Hello from the guest\n' > /workspace/index.html
services:
  web:
    command: python3 -m http.server $PORT --bind 127.0.0.1
    health: /
    preview: true
```

Ask the agent to create an environment named `demo` from `sandbox.yaml` and open its preview. The `sandbox` tool accepts `help` or a JSON action in its `input` field. In Code and Notebook modes, use the deferred entry point:

```js
await tools.sandbox('help')
await tools.sandbox('{"action":"create","name":"demo","config":"sandbox.yaml"}')
```

The result includes a localhost preview URL. Open it in a browser on the VM host. Previews are unauthenticated and reachable by other processes on that host. A localhost URL from a remote host is not a browser-accessible remote link. Public exposure, remote authentication, and cloud hosting are deliberately outside this package.

## Keep, reopen, or remove

`create` makes a fresh independent disk. `start` reconnects to an already-running instance or reopens its last completed disk checkpoint. `stop` disconnects preview and terminal clients, stops services, and checkpoints the disk. Uncommitted files, installed packages, application data, and guest home files persist without a Git push.

The controller is independent of the calling Pi session. Reloading or quitting Pi does not stop its environments. Use `list`, `inspect`, `stop`, and `destroy` explicitly. Destroy requires `confirm` to match the name and irreversibly removes the instance's owned disk and logs.

```js
await tools.sandbox('{"action":"stop","name":"demo"}')
await tools.sandbox('{"action":"start","name":"demo"}')
await tools.sandbox('{"action":"destroy","name":"demo","confirm":"demo"}')
```

Disk checkpoints are not crash-safe live storage. If the controller or host crashes before stop completes, only the last completed checkpoint is recoverable. `inspect` reports interrupted or unavailable controllers instead of treating a stale status file as a running VM. Keep the image assets available for later reopen.

State lives under `$XDG_STATE_HOME/pi-sandbox`, defaulting to `~/.local/state/pi-sandbox`. Users can select a private, short state directory with `PI_SANDBOX_HOME` before starting Pi. Instances and prepared templates have separate names and storage.

## Prepare a template

`prepare` runs the YAML's setup commands and saves a disk template without starting services. `create` with `template` copies that prepared disk into an independent instance. Setup does not run again. Resume hooks and declared services run on each instance start.

```js
await tools.sandbox('{"action":"prepare","name":"web-base","config":"sandbox.yaml"}')
await tools.sandbox('{"action":"create","name":"review-one","template":"web-base"}')
await tools.sandbox('{"action":"create","name":"review-two","template":"web-base"}')
```

Templates are reusable prepared filesystems, not existing named instances. Never put tokens, provider logins, private keys, or other secrets in templates or setup commands. Perform fresh login in an instance after creation. YAML is validated strictly. Each disk receives an independent `.sandbox.yaml` in its guest workspace. Edit that guest file with `write` or a guest terminal, then ensure or restart services. Editing the original host YAML does not change existing disks. Hardware, network, setup, and resume settings remain captured at creation.

## Resources and services

| Profile | CPUs | RAM |
| --- | ---: | ---: |
| tiny | 1 | 2 GiB |
| small, default | 2 | 4 GiB |
| medium | 4 | 8 GiB |
| large | 8 | 16 GiB |
| xlarge | 16 | 32 GiB |

These are presets, not minimum-resource claims. Override them with `resources: { cpus: 2, memoryGiB: 3 }`. Disk capacity defaults independently to 60 GiB and is sparse. Written data and base images consume real host storage. This is not a physical storage quota. Unsupported resources fail rather than being silently reduced.

`setup` and `resume` are lists of guest login-shell commands. Executable `.agents/setup` and `.agents/resume` scripts in the workspace run after the corresponding YAML commands. Setup has one 20-minute deadline. Its descendants are stopped before activation, including detached children. Failure is reported but instance startup continues. Failed setup never publishes a prepared template. Resume waits up to 10 seconds, then continues in the background. Inspect returns a `resumePid` for following unfinished work through `exec-status`.

`workspace` is an absolute guest path. Service and execution `cwd` default to the workspace root and accept workspace-relative paths. An optional `image` points to a Gondolin assets directory, resolved relative to the host YAML file.

Outbound HTTP is blocked by default. Allow only the hosts required by your environment:

```yaml
network:
  allowedHosts:
    - registry.npmjs.org
```

No host checkout, home, Docker socket, provider credentials, or SSH agent is mounted or forwarded. Guest commands and setup are administrative operations inside the VM, not host shell execution.

Services require a foreground login-shell `command`. Names contain 1 to 32 lowercase letters, digits, or hyphens and start with a letter or digit. Omit `port` to allocate a free guest port. Assigned ports remain unchanged on restart and reopen. Fixed ports must be unique. The package supplies `PORT` and, for a service with preview links, `PUBLIC_URL`. Optional `env` entries cannot replace these variables.

Use `services` with `ensure`, `status`, `restart`, or `stop`, optionally selecting one service. Ensure reads the current guest YAML and starts missing services. Restart reads the latest command, working directory, environment, and health path while retaining the assigned port and existing preview configuration. Ensure updates link declarations without replacing live processes. Services restart one second after exit, including successful exit. In this local implementation, ensure revives explicitly stopped services and reopen starts all declared services. Amp's public contract does not settle those two policies or successful-exit restart behavior.

Readiness checks TCP by default. Set `health: /path` for an HTTP GET that accepts 2xx or 3xx after the port opens. The local declared-service readiness deadline `timeoutMs` defaults to 30000. Ad-hoc `service-start` waits up to 60 seconds and rejects names declared in the current YAML. A preview URL alone is not proof of readiness. Failure leaves the instance running so you can read `logs` and repair or stop the service.

Use `preview` with a guest `port`, optional `title`, and optional `description` to link an already-listening HTTP server without starting or supervising it. Gondolin's ingress accepts plain HTTP backends. HTTPS-only guest listeners require an HTTP-facing application proxy. This package does not implement Amp's authenticated domains or review interface.

Guest HTTP responses must use `Content-Length` or chunked framing. Gondolin 0.13's transport can reset valid close-delimited responses before its gateway finishes forwarding them, producing an intermittent 502 even when the guest logged a response. Use explicit response framing in the application or its HTTP-facing proxy. TCP readiness alone cannot detect this failure.

`preview: true` links to `/` with the service name. A mapping accepts `url`, `title`, and `description`, defaulting the first two to `/` and the service name. `previews` adds links to the same service, either `{url, title, description?}` or a one-level `{folder, links}` group. Folder names must be unique within a service. URLs accept application paths or absolute HTTP/HTTPS links. Entry paths do not remount the application. Results preserve link titles, descriptions, and folders. Local previews support HTTP and WebSockets. Their localhost ports are retained on reopen, but rebinding fails if another process has taken one. Always use returned URLs.

Environment values may contain `${services.web.publicURL}`. The referenced declared service starts first and must have a preview. Missing references, cycles, and references to excluded services are rejected. `platforms: [linux]` or `[darwin]` filters by the guest OS, which is always Linux even on a macOS host. Empty platform lists are invalid. Amp review-widget injection and Amp identity placeholders are not available. `review: true`, `AMP_THREAD_ID` environment overrides, and `$AMP_USER_EMAIL` preview placeholders are rejected explicitly.

`exec` waits up to `timeoutMs`, default 10000 and range 0 to 60000. **Timeout only ends the wait. The command keeps running.** A continuing command returns an opaque string `pid` handle and `running: true`, not a guest process ID. Use `exec-status` with that handle to wait and retrieve new output, or `exec-kill` to request process-group termination. Status waits do not block file operations, other commands, or kill. Handles belong to the current controller and do not survive stop or restart. Long-lived applications belong in supervised services.

Completed handles are bounded to 128. Consuming completed output removes its guest files but retains final status with empty output. New command launches may expire older completed handles and discard their unread output. Collect needed output before launching more commands. Reopen removes stale command files from the previous controller.

```js
const command = await tools.sandbox('{"action":"exec","name":"demo","cmd":"sleep 30; echo done","timeoutMs":0}')
await tools.sandbox(JSON.stringify({action: 'exec-status', name: 'demo', pid: command.pid, timeoutMs: 1000}))
await tools.sandbox(JSON.stringify({action: 'exec-kill', name: 'demo', pid: command.pid}))
```

`read`, `write`, and `logs` provide guest text-file access and bounded output. Read and execution output are capped at 64 KiB and mark truncation. Execution status returns only output not previously consumed. Use `help` for current arguments.

## Open a guest terminal

Run `/sandbox <name> [user]` in Pi to get a temporary localhost SSH command. The user defaults to `root`. Run the returned command in a terminal on the VM host. The guest image must include an OpenSSH server and Gondolin's `sandboxssh` helper.

The terminal uses a newly generated key, disables agent forwarding, and disconnects on stop. It does not import host credentials. Install and run whichever tools you choose inside the guest. If a tool needs authentication, complete your own fresh login in the instance, not in a reusable template. Allow its required hosts in the YAML before creation. Credentials saved in the instance persist on reopen. Checkpoints are ordinary local files protected by directory permissions, not package-managed encryption.

## Recovery

Readiness errors name the service and leave guest logs available. Start failures keep controller logs available through `logs` without a service name. Read those logs before retrying. Missing guest tools require compatible user-provided Gondolin assets, not patches to installed host tools. Commands and services require Python 3. Guest terminals require OpenSSH and Gondolin's `sandboxssh` helper. Gondolin disk growth requires `resize2fs` in the guest.

Removing the Pi package does not remove running environments or their data. Stop or destroy owned instances first.
