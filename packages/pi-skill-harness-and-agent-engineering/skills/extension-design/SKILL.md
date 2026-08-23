---
name: extension-design
description: "Read before creating or refining a coding-agent extension."
last-changed: "2026-08-23"
---

## Choose the surface before coding

Start from the experience the user wants, not from extension machinery. Before implementation, identify:

- who initiates the workflow
- how often it occurs
- what the harness or an existing CLI already provides
- which interface the workflow actually needs

Choose between direct CLI use, a script, skill, user-invoked slash command, human UI, agent tool, or extension integration. Confirm that shape with the user before writing code.

Prefer the smallest missing piece. If a CLI already owns the capability but is awkward to use from the harness, wrap it thinly rather than rebuilding it. Custom extension behaviour is earned by integration needs such as UI, state, hooks, events, or tool registration.

Do not register an agent tool merely because an extension can. A permanent tool must earn its model cost through repeated natural use or a capability the agent cannot otherwise reach. For rare or explicitly requested workflows, prefer a user-invoked command, script, or CLI, with a skill only when the agent needs invocation guidance.

## Fit the real harness

Inspect the user's setup and conventions before designing around an abstract ideal. Reuse its existing navigation, settings, command, and tool patterns. Add engineering machinery only for risks and requirements present in this workflow. Do not turn a personal convenience into an enterprise subsystem because testing, permissions, retries, compatibility layers, or configurability sound generically respectable.

Treat the human interface and agent toolkit as separate products. Either may exist without the other, and they should not be mirrored by default.

- Users operate interfaces and slash commands. A prompt-template command is still user-invoked, not an agent capability.
- Agents use tools or discoverable CLIs. Give them only decisions they genuinely make, and keep deterministic policy and implementation choices in the host.
- If settings, persistent state, or several user actions exist, prefer one skimmable management surface. Configuration files are storage, not the ordinary interface.
- Where both audiences need the same underlying operation, share its implementation while giving each audience the vocabulary and result it needs.
- Agent-facing results should say what happened and provide the state, evidence, path, handle, recovery, or exact continuation naturally needed next. Do not enlarge a tool to swallow the surrounding workflow.

Load an applicable tool-design skill before adding or changing an agent-facing tool.

## Keep the interface out of the README

The README should explain the outcome, installation, first action, and material boundaries. Settings and actions belong in the product. If ordinary use requires reading a manual or memorizing a command family, redesign the interface before polishing documentation.

## Justify permanent model cost

Measure an equivalent first turn with and without the extension while keeping the model, prompt, context, and harness version fixed. Inspect schemas, descriptions, injected instructions, startup messages, and tool results. Remove facts the model already knows, choices the host can infer, and interfaces agents rarely use.

Optimize task success before token count. A compact but unclear surface is not an improvement.

## Test with the user

Run the local candidate in isolation before changing the live setup. The easiest arrangement is a visible sibling pane in tmux or Herdr so the user can compare it with the main session. Consult the harness help and `herdr --skill` rather than carrying pane mechanics here. For Pi, a disposable `PI_CODING_AGENT_DIR` with `pi -nc -ns -ne -e <candidate>` is a useful starting point.

- Let the user operate and judge the human surface. The agent cannot self-certify UX from code, screenshots, or automated checks.
- Test the agent surface separately in a fresh visible session using a natural request and a nearby request where it should remain unused.
- Stop after each meaningful run so the user can inspect it. Leave test panes open until the user permits cleanup.
- Follow up naturally within the same investigation. Use a fresh session when startup or first-use behaviour is evidence.

Once the isolated shape satisfies the user, enable it with their complete setup. Check only relevant integration risks, including collisions, displaced capabilities, startup overhead, prompt caching, and removal behaviour. Let the user perform their normal workflow and decide whether the extension improves it or merely adds management.

Remove commands, settings, modes, integrations, and documentation that survive only because they sound useful. Popularity proves demand, not interface quality. The extension is successful when the user prefers their real harness with it and it disappears into the workflow after setup.
