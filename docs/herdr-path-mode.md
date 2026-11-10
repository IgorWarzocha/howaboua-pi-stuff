# Herdr-backed PATH mode

Parked design idea, 10 November 2026. No implementation is authorised by this note.

Use Herdr Core as PCC's execution environment. The agent runs real programs in Core-managed terminals instead of composing JavaScript calls inside a separate Code host. Pi-specific tools become callable commands through a private PATH.

The model-facing execution tool would be named `hc`, matching the actual CLI. Its exact input format is still open. It must carry command arguments and stdin, not merely offer a fixed menu of terminal operations.

## Core already executes code

The language runtime can simply be the program being launched. Python, Perl, Bun and ordinary shell commands already provide composition, file operations and data processing.

For short work, Core accepts a program and its input directly:

```sh
hc exec -i python3 <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory

with TemporaryDirectory(prefix="hc-path-idea-") as directory:
    path = Path(directory) / "example.txt"
    path.write_text("first version\n")
    path.write_text(path.read_text().replace("first", "second"))
    print(path.read_text(), end="")
PY
```

Long-running work can use a persistent terminal:

```sh
hc run --bg --name build cargo build --release
hc wait build
hc read build --lines 40
hc rm build
```

These are existing CLI commands, not a proposed new language. The eventual native `hc` tool should expose this capability directly. It should not require the model to wrap every operation in another execution tool.

Core owns execution, terminal access, process lifetimes, output and exit reporting. PCC owns the model-facing interface and integration with Pi. This removes the separate Code execution host for this mode, not Pi's tool-call semantics.

## Reuse a working terminal

An agent could keep one working terminal for quick commands and create others when work needs concurrency or a separate lifetime.

A persistent shell already supplies a REPL. Its working directory, environment, variables and functions survive between commands. A Python or Bun REPL can remain running there when language-level state is useful. Separate Python invocations do not implicitly share globals, and this design does not promise notebook-style state serialisation.

The workspace is visible to both the agent and the person using Herdr. Either can inspect the actual process, attach to its terminal or take over its input.

## The same Pi tools through PATH

Ordinary file operations need no translation into Pi tool calls. Real programs already do that work. The bridge is for Pi-specific capabilities such as Notes, Board, Ask and browser tools.

Generate CLI bindings from the tools actually available to the session:

- Use the existing registrations, argument schemas, help and activation state.
- Keep the host's normal PATH and add a private tool-command directory for the execution environment.
- Route tool commands through a small dispatcher into Pi's supported tool invocation boundary.
- Keep discovery and detailed contracts available on demand rather than loading a second full catalogue into the standing prompt.
- Do not invent shell equivalents independently or expose disabled tools through stale commands.

One dispatcher can back the bindings. The command namespace and collision policy are undecided. The old PATH mode establishes the environment-injection approach, but it only exposed a few bundled tools. This would be its generic successor, not a restoration of the old implementation wholesale.

Tool results still need their proper channels. Text can go to stdout. Images, interactive questions, cancellation and structured errors must retain their Pi behaviour rather than being flattened into terminal text.

## Share execution without merging agents

Several agents could observe the same dev server, inspect the same logs or hand over a debugger session without restarting it. They would share terminal references instead of duplicating processes and copying logs between notebooks.

Many readers are useful. Input needs deliberate turn-taking so agents do not send competing commands into the same terminal.

Terminal ownership must remain separate from the identity of the agent making a Pi tool call. A shared terminal must not route every Notes write to whichever agent created it. A private endpoint inherited from the creator alone would not solve shared use.

Shared services also need an explicit owner and lifetime. They should neither disappear accidentally when a disposable worker closes nor become detached processes with no cleanup owner.

## Completion and context continuity

Core already reports terminal exits to the calling agent. Reuse that mechanism rather than adding another process watcher for a Core-backed mode.

Normal monitoring remains primary. A forgotten completion should wake the agent only when it is idle and the result remains uncollected. Active work should not receive extra completion steering or duplicate reports. How Core's existing delivery meets that intake policy needs to be checked before adding any adapter logic.

After compaction or Notes rollover, restore a compact inventory of running terminals and uncollected results. Include terminal references, commands and status in late chronological runtime context.

Do not put live terminal state in the standing system prompt. Do not regenerate it every turn because a dev server is still running. Do not rewrite earlier messages or require agents to keep copying process inventories into Notes.

The existing PCC shell-recovery work remains separate. Parking this idea does not replace or revert it.

## What was actually tried

A disposable experiment used a real Core-managed zsh terminal:

1. Set and exported a temporary-directory variable in the shell.
2. Created `app.py` and `settings.json` using Python.
3. Reused the same shell variable in a later command.
4. Edited the source and JSON with Python, then edited the source with Perl.
5. Executed the edited Python file and verified its result and the JSON contents.
6. Exited the shell successfully and collected its exit status through Core.

A separate `hc exec -i python3` invocation composed file creation, a Perl subprocess, reads and assertions in one program. It returned clean JSON output and a successful exit status.

Both experiments passed. The disposable files and terminal were removed. No repository files were changed by the experiments.

One concrete limitation surfaced: `hc send --wait` timed out on the interactive shell even though the submitted commands had finished. Its wait follows an agent turn or terminal lifetime, not an arbitrary shell command boundary. A reusable-shell interface needs reliable command and output framing. Program-per-execution through `hc exec` already has a clear process-completion boundary.

## Pi's invocation lifetime still matters

Pi retires nested tool-call IDs when the enclosing tool result returns. Current Code Mode drains admitted calls before yielding and waits for the next active observation before accepting later calls.

A background shell cannot retain an expired Pi tool context and keep invoking tools through it. The CLI bridge must preserve that admission boundary, even without a JavaScript execution host. It also needs to retain the acting agent's identity across terminal sharing.

The current boundary is implemented in [`PiToolCallScope`](../packages/pi-codex-conversion/src/tools/code-mode/pi-tool-call-scope.ts). It is a useful integration reference, not an instruction to retain the whole Code runtime.

## Why revisit it

- One execution substrate for the person and the agent, with direct inspection and takeover.
- Core-owned persistence, concurrency, lifetimes and completion reporting instead of parallel PCC machinery.
- Familiar language runtimes and CLI composition rather than a mandatory JavaScript tool-wrapper environment.
- A smaller execution integration to maintain, with Pi-specific tool handling kept at one bridge.

The main trade is less embedded notebook convenience. This idea does not decide the future of Structured mode or the existing notebook modes.

## Decisions left for a future experiment

- The native `hc` tool's argument and stdin format, including discovery.
- Reliable command-completion boundaries when reusing an interactive terminal.
- Generic tool-command generation, namespacing and activation updates.
- Pi tool admission, rich results and caller identity across shared terminals.
- Core exit-report intake without busy-agent interruption or duplicate completion notices.
- How the mode fits alongside existing execution modes and behaves when Core is unavailable.

When revisiting the idea, start with one real Core execution path and one bridged Pi tool. Prove the complete invocation and result path before replacing runtime machinery.
