Diagnose from evidence. Leave the machine unchanged unless the requested work includes a fix.

## Establish the event

Start with the exact PID when available:

```bash
coredumpctl info <pid>
coredumpctl list
```

1. Record the executable, signal, timestamp, command line, and stack.
2. Use the list to distinguish one crash from recurrence or several programs failing together.
3. Rule out resource exhaustion:

```bash
free -h
journalctl -k -b --no-pager | rg -i 'oom|out of memory|killed process'
```

4. Correlate the timestamp with the relevant journal window, file mtimes, and recent package updates.
5. Read every available thread stack. Worker threads may reveal active decoding, thumbnailing, IPC, GPU, or plugin work.
6. Record extensions, plugins, out-of-tree drivers, and third-party libraries without assigning blame until evidence implicates them.

## Symbolize safely

Use Arch debuginfod when unresolved frames prevent a useful diagnosis:

```bash
core=$(mktemp -t crash-XXXXXX.core)
trap 'rm -f "$core"' EXIT
coredumpctl dump <pid> --output="$core"
DEBUGINFOD_URLS="https://debuginfod.archlinux.org" \
  gdb -q <executable> "$core" -batch \
  -ex 'set debuginfod enabled on' -ex 'thread apply all bt full'
```

A core may contain passwords, tokens, messages, and private documents. Use a fresh temporary path, never upload it, and delete the extracted copy before finishing. Report unresolved frames honestly when symbols remain unavailable.

## Report

State what crashed, what it was doing, what evidence proves, what remains inferred, whether user data was lost, available recovery including Trash, recurrence, and the narrowest avoidance or fix. Ambiguity is a result.

Omarchy owns crashes in its commands, Quickshell shell and plugins, shipped Hyprland or terminal configuration, themes, packaging, and install or migration scripts. An application merely installed by Omarchy normally belongs upstream unless Omarchy config or packaging is implicated.

When the user asks to publish an issue or comment, load an applicable repository issue skill. Search open and closed issues first. Add evidence to an existing report only when the failure matches. Do not publish unless the user asked to file it or approved the exact report. Never install or authenticate GitHub tooling for the report.

Include expected and actual behavior, reproduction, `omarchy version`, relevant diagnostics, and only evidence-backed conclusions. Questions belong on Omarchy Discord and feature ideas in GitHub Discussions. Never upload a core or use a diagnostic upload flow.
