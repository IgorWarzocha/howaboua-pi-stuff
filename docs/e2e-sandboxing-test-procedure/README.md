# How we test Pi changes in a sandbox

Our E2E reviews pair an implementing agent with a dedicated sandbox reviewer. The implementer works in the host checkout. The reviewer controls a disposable VM and uses the changed application: Pi, its extensions, Herdr agents and, where relevant, the Deno Notebook kernel.

Two Pi extensions provide the machinery:

- **[Pi Sandbox](../../packages/pi-sandbox/README.md)** (`@howaboua/pi-sandbox`) gives the reviewer the `sandbox` tool to create, start and stop VMs, run guest commands, read and write files, and inspect logs. It is built on Gondolin's QEMU microVMs. The reviewer controls it from the host.
- **[Shepherdr](../../packages/pi-shepherdr/README.md)** (`@howaboua/pi-shepherdr`) gives the implementer the `agents` tool to spawn the `sandbox-reviewer` profile in Herdr, exchange messages and receive completion reports. The reviewer is another Pi agent, not a feature built into the VM.

[Agent Board](../../packages/pi-agent-board/README.md) holds shared findings and retest discussions. [Notes Compaction](../../packages/pi-notes-compaction/README.md) keeps resumable checkpoints as agents move through context windows.

The review is driven by the branch diff. We do not have a fixed E2E suite that every change runs through. The reviewer builds scenarios and small probes around the changed workflows, then works with the implementer to reproduce failures and retest fixes.

```mermaid
sequenceDiagram
    participant I as Implementer on host
    participant R as Sandbox reviewer
    participant V as VM running candidate
    I->>R: Changed workflows, candidate and exclusions
    R->>V: Snapshot checkout, build and launch
    R->>V: Exercise application workflows
    R-->>I: Failure, evidence and likely owner
    I->>I: Fix source and run focused checks
    I-->>R: Replacement candidate ready
    R->>V: Stop test agents, refresh and restart
    R->>V: Retest affected workflows
    R-->>I: Results and remaining gaps
    R->>V: Close test processes and stop VM
```

## What Pi Sandbox runs for us

Pi Sandbox is the agent-facing control layer for a real virtual machine. It starts a separate controller process on the host. That controller uses Gondolin to run QEMU with hardware virtualisation, a guest filesystem and configured CPU, memory and disk resources.

```mermaid
flowchart LR
    Agent[Reviewer in host Pi] --> Tool[Pi Sandbox extension]
    Tool --> Controller[Persistent host controller]
    Controller --> Gondolin[Gondolin and QEMU]
    Gondolin --> Guest[Guest Pi, Herdr and candidate extensions]
```

The controller outlives the calling Pi session. A reviewer can change context, reload Pi or exit without automatically killing the VM. The agent explicitly starts and stops named instances through the tool.

Inside the guest, the extension runs shell commands, exposes their output and exit status, and provides file reads and writes. Long commands return a handle so the reviewer can retrieve later output or stop the process. Ending a wait does not kill the guest command. The extension also supports supervised services, localhost previews and a temporary SSH terminal for interactive work.

For our reviews, this gives the agent somewhere to install and build the candidate, launch Pi and Herdr, create test fixtures, inspect logs and repeat a failing workflow. The guest has its own filesystem. Our repository setup script copies a candidate into it rather than mounting the live host checkout. Pi Sandbox supplies the environment controls; it does not install a reviewer or decide what counts as a passing test.

Stopping an instance checkpoints its disk. Installed tools, saved sessions and evidence can survive reopening, but memory and running processes do not. That is why we can reuse a provisioned guest while still restarting the application after a candidate refresh. The image itself is supplied separately; the extension does not ship one.

## From a diff to a review

We first read the net branch changes and group them by behaviour. A context-management change becomes a note-write, rollover and recovery scenario. A scheduling change becomes several real tool calls in one response. A shared-agent change becomes a child receiving its first task, reading shared context and reporting back to an idle or busy parent.

The assignment names the candidate, affected extensions, workflows, provider routes and exclusions. It also tells the reviewer which earlier evidence is reusable. That matters on a long-lived branch: an intermediate approach may already have been replaced, and repeating every previous check adds little.

The reviewer reports concrete failures as they appear. The implementer fixes host source while the reviewer continues independent scenarios. We use a shared board for findings and retest results, and notes for each agent's resumable state. The reviewer's completion report arrives asynchronously.

## What runs in the VM

We reuse a provisioned Pi Sandbox instance and replace its candidate checkout:

```sh
bun run sandbox:setup --name review
```

The [repository setup command](../../scripts/setup-repo-sandbox.mjs) transfers tracked working files, verifies the archive, installs the frozen lockfile and builds the required artifacts. It uses JJ's file list when `.jj` exists, otherwise Git's index. JJ may track new files automatically, so unstaging them in Git does not exclude them. Keep evaluator prompts and answers outside the checkout during model comparisons. `sandbox-snapshot.json` records the source revision and archive hash.

The command prints the guest launch command. It uses an isolated Pi agent directory and the candidate's PCC and Shepherdr packages. The reviewer adds other affected extensions, such as Notes or GitHub Watch, to that guest configuration. It then checks the running application, rather than assuming a successful build means the intended extensions loaded.

The guest is not a live mirror. After a host fix, the reviewer stops its test agents, runs setup again and starts fresh processes against the replacement candidate. The VM's separate agent directory and test evidence survive candidate replacement.

Image provisioning and prerequisites belong in [Pi Sandbox's repository-review guide](../../packages/pi-sandbox/README.md#review-this-repository). We do not bundle an image. Release acceptance must use the candidate's bundled native helpers without overrides. Check guest compatibility first and replace incompatible disposable guests rather than rebuilding helpers around them. For live TUI review, pass `--live-model openai-codex/MODEL` to setup with an available model so the guest's authenticated readiness is checked.

## How we drive the application

Interactive Pi and Herdr cover pane behaviour, commands, child agents and visible streaming. For narrower backend-acceptance checks, we also create a headless Pi session with the SDK, load the real extensions and call `bindExtensions` before sending the task. This still exercises application lifecycle and tools. It does not establish terminal UX.

Scenarios combine actions rather than just checking startup. For example: save a unique fact in a note, start a new context, read the fact back, search earlier history and continue with another tool. We have also left real idle and polling intervals running when timing itself was the behaviour under review.

Controlled HTTP, WebSocket and GitHub boundaries let the reviewer trigger retries, disconnects and notifications without waiting for an external service to misbehave. Live model runs answer a different question: whether the actual backend accepts the request and the model consumes the tool result. [Models and evidence](models-and-evidence.md) explains that split and how we switch between Codex Responses, Responses Lite and other providers' Chat Completions routes.

## Reusing the setup

- [Sandbox reviewer profile](assets/sandbox-reviewer/) contains the reusable review instructions. The profile's model runs the reviewer, not the application under test.
- [Headless launch example](headless.md) shows the SDK path used for focused acceptance checks.
- [Notes continuity procedure](notes-continuity.md) compares first-try checkpoint and fresh-context use during real tasks. The [2 November 2026 findings](notes-continuity-results.md) record improvements and remaining failures.
- [Free-model verification skill](../../.pi/skills/pi-stuff-free-model-smoke/SKILL.md) covers live catalogue checks and a small tool-result round trip before selecting a free test model.

The reviewer finishes with what passed, what failed, what was blocked and where the evidence lives. We keep a host-accessible summary as well as guest captures. Temporary test credentials and owned processes are removed, then the VM is stopped. The implementer runs the remaining source checks after fixes converge. A sandbox pass does not update the host's installed extensions or publish a release.
