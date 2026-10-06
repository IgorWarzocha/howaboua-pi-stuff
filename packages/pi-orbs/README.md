# Pi Orbs

Named local environments for Pi, powered by [Gondolin](https://github.com/earendil-works/gondolin). Prepare a reusable environment, create independent instances, and keep a dashboard running after the controlling Pi session exits.

This is an optional package, not part of the aggregate Pi packages. It uses local QEMU microVMs, not Amp infrastructure. Stop saves disk state. Reopen boots a new VM and restarts services. Memory, running processes, and browser connections do not resume.

## Start an environment

Requires Node.js 24 or newer on `PATH`, QEMU and `qemu-img`, plus Linux KVM access or macOS HVF. Install those through your operating system's supported package manager. Linux x86_64 is integration-tested. macOS uses Gondolin's supported QEMU backend but has not been tested here.

```sh
pi install npm:@howaboua/pi-orbs
```

Create `orbs.yaml` in your project:

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
    cwd: /workspace
    port: 8000
    health: /
    portal: true
```

Ask the agent to create an environment named `demo` from `orbs.yaml` and open its portal. The `orbs` tool accepts `help` or a JSON action in its `input` field. In Code and Notebook modes, use the deferred entry point:

```js
await tools.orbs('help')
await tools.orbs('{"action":"create","name":"demo","config":"orbs.yaml"}')
```

The result includes a localhost portal URL. Open it in a browser on the VM host. Portals are unauthenticated and reachable by other processes on that host. A localhost URL from a remote host is not a browser-accessible remote link. Public exposure, remote authentication, and cloud hosting are deliberately outside this package.

Stock Gondolin images support this dashboard example. Running the complete Pi agent with Pi Codex Conversion requires a compatible custom image. See below.

## Keep, reopen, or remove

`create` makes a fresh independent disk. `start` reconnects to an already-running instance or reopens its last completed disk checkpoint. `stop` disconnects portal and terminal clients, stops services, and checkpoints the disk. Uncommitted files, installed packages, application data, and guest home files persist without a Git push.

The controller is independent of the calling Pi session. Reloading or quitting Pi does not stop its environments. Use `list`, `inspect`, `stop`, and `destroy` explicitly. Destroy requires `confirm` to match the name and irreversibly removes the instance's owned disk and logs.

```js
await tools.orbs('{"action":"stop","name":"demo"}')
await tools.orbs('{"action":"start","name":"demo"}')
await tools.orbs('{"action":"destroy","name":"demo","confirm":"demo"}')
```

Disk checkpoints are not crash-safe live storage. If the controller or host crashes before stop completes, only the last completed checkpoint is recoverable. `inspect` reports interrupted or unavailable controllers instead of treating a stale status file as a running VM. Keep the image assets available for later reopen.

State lives under `$XDG_STATE_HOME/pi-orbs`, defaulting to `~/.local/state/pi-orbs`. Users can select a private, short state directory with `PI_ORBS_HOME` before starting Pi. Instances and prepared templates have separate names and storage.

## Prepare a template

`prepare` runs the YAML's setup commands and saves a disk template without starting services. `create` with `template` copies that prepared disk into an independent instance. Setup does not run again. Resume hooks and declared services run on each instance start.

```js
await tools.orbs('{"action":"prepare","name":"web-base","config":"orbs.yaml"}')
await tools.orbs('{"action":"create","name":"review-one","template":"web-base"}')
await tools.orbs('{"action":"create","name":"review-two","template":"web-base"}')
```

Templates are reusable prepared filesystems, not existing named instances. Never put tokens, provider logins, private keys, or other secrets in templates or setup commands. Perform fresh login in an instance after creation. YAML is validated strictly and captured at creation. Later edits do not change existing instances or templates.

## Resources and services

| Profile | CPUs | RAM |
| --- | ---: | ---: |
| tiny | 1 | 2 GiB |
| small, default | 2 | 4 GiB |
| medium | 4 | 8 GiB |
| large | 8 | 16 GiB |
| xlarge | 16 | 32 GiB |

These are presets, not minimum-resource claims. Override them with `resources: { cpus: 2, memoryGiB: 3 }`. Disk capacity defaults independently to 60 GiB and is sparse. Written data and base images consume real host storage. This is not a physical storage quota. Unsupported resources fail rather than being silently reduced.

`setup` and `resume` are lists of guest shell commands. Each command has a two-minute deadline. Workspace and service `cwd` values are absolute guest paths. An optional `image` points to a Gondolin assets directory, resolved relative to the YAML file.

Outbound HTTP is blocked by default. Allow only the hosts required by your environment:

```yaml
network:
  allowedHosts:
    - registry.npmjs.org
```

No host checkout, home, Docker socket, provider credentials, or SSH agent is mounted or forwarded. Guest commands and setup are administrative operations inside the VM, not host shell execution.

Services require a foreground `command` and a unique explicit guest `port`. The package supplies `PORT` and, for a portaled service, `PUBLIC_URL`. Optional `env` entries cannot replace these variables. Services restart one second after exit, including successful exit. Use `services` with `ensure`, `status`, `restart`, or `stop`, optionally selecting one service. Ensure revives explicitly stopped services. Reopen starts all declared services.

Readiness sends an HTTP GET to `health`, defaulting to `/`, and accepts 2xx or 3xx. `timeoutMs` defaults to 30000. This differs from Amp's default TCP-listener check. A portal URL alone is not proof of readiness. A readiness failure leaves the instance running so you can read `logs` and repair or stop the service. Portals support HTTP and WebSockets. URLs can change after reopen, so use returned URLs rather than constructing them.

`exec` has a bounded wait and stops its command process group on timeout. Long-lived applications belong in declared services. `read`, `write`, and `logs` provide guest text-file access and bounded output. Read and execution output stop at 64 KiB and mark truncation. Use `help` for the complete current arguments.

## Run Pi in the guest

`images/Dockerfile` builds a Debian Trixie image with Node, Bun, Pi 1.0.4, Pi Codex Conversion 3.0.46, OpenSSH, and public Code and Notebook runtime caches. It contains no provider auth. Debian Trixie meets the current native executor's glibc requirement. Stock Alpine is not compatible with that executor.

With Docker and Gondolin's documented image-build prerequisites installed, copy the package's `images` directory to a build directory. Build only that directory, not your project or home:

```sh
docker build -t pi-orbs-guest:local images
npx --yes --package=@earendil-works/gondolin@0.13.0 \
  gondolin build --config images/gondolin.json --output guest-assets
```

The supplied image config targets `x86_64`. For an ARM host, select `aarch64` before building and use matching OCI images. The SDK image builder uses Alpine boot assets around the Debian OCI root filesystem.

Set `image: ./guest-assets` in your environment YAML and create an instance. Run `/orbs <name> node` in Pi to get a temporary localhost SSH command. Run that command in a terminal on the VM host, start `pi` under `/workspace`, and complete your own fresh login. This runs the entire Pi process and its tools inside the guest. Host Pi tools remain host tools unless you explicitly operate through `orbs`.

The terminal uses a newly generated key, disables agent forwarding, and disconnects on stop. It does not import host provider auth. Allow the required authorization and API hosts in the YAML before creation, with the user's approval. Provider OAuth callback behavior has not been tested. The user must authorize any real login or provider request. A login saved inside an instance's home persists on reopen, but never enters the reusable template. Checkpoints are ordinary local files protected by directory permissions, not package-managed encryption.

## Recovery

Readiness errors name the service and leave guest logs available. Start failures keep controller logs available through `logs` without a service name. Read those logs before retrying. Missing Python 3, OpenSSH, `resize2fs`, or Gondolin's SSH helper in a custom image requires rebuilding that image, not patching installed tools.

Removing the Pi package does not remove running environments or their data. Stop or destroy owned instances first.
