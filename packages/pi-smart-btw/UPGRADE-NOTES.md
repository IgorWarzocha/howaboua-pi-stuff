# Smart BTW upgrade notes

Notes from the Howcode native-extension port, written as guidance for upgrading the standalone Pi TUI extension.

The useful direction is not “make it a GUI thing”. It is: make `/btw` a durable, multi-slot, Pi-TUI-native Q&A side-session system.

## Desired Pi-TUI behavior

### Multiple numbered sessions

Support stable numbered slots:

```text
/btw 1 what is this repo?
/btw 2 explain this error
/btw 1 continue that answer
```

Rules:

- `/btw` opens/shows the BTW panel.
- `/btw 1` switches to session 1.
- `/btw 2` switches to session 2.
- `/btw 1 <question>` starts or continues slot 1.
- `/btw <question>` continues the active slot, or creates slot 1 if none exists.
- Slot numbers are stable. Do not renumber after clearing slot 1 while slot 2 exists.
- Clearing/injecting frees that slot number for reuse.

### Per-slot subprocesses

Each BTW slot should own its own ephemeral child Pi RPC process.

Avoid a single global queue. A slow/stuck session 1 must not block session 2.

Recommended state shape:

```ts
type BtwSession = {
  slot: number
  generation: string
  child?: BtwChild
  turns: BtwTurn[]
  running: boolean
  unread: boolean
  queue: Promise<void>
}
```

### Widget is status, transcript is answers

Keep the above-editor widget small. It should show status and controls, not dump full answers.

Good widget shape:

```text
╭─ btw running default:low sessions [1] 2
│ Q what is this repo?
│ … thinking
╰─ ctrl+alt: +z compose · +c inject & clear · +x clear · ↑/↓ fold · ←/→ switch
```

When answered:

```text
│ ✓ answered — see btw result in transcript
```

The full answer should appear as a custom transcript message, using a renderer.

### Custom transcript messages are canonical state

Store every completed turn as a custom message in the main JSONL.

Use one stable custom type, and put the human label in details:

```ts
pi.sendMessage({
  customType: "BTW SESSION",
  content: answer,
  display: true,
  details: {
    kind: "result",
    label: "BTW SESSION 1-1",
    slot: 1,
    generation: "unique-generation-id",
    turn: 1,
    question,
    answer,
    error,
    startedAt,
    finishedAt,
  },
})
```

Why one `customType`?

- Pi message renderers match exact custom types.
- `customType: "BTW SESSION 1-1"` would require dynamic renderers or fallback rendering.
- `customType: "BTW SESSION"` lets one renderer handle all BTW results.

### Filter BTW messages from model context

BTW result messages are durable UI/session state, not automatic context for the main agent.

Filter them from the LLM context until the user explicitly injects:

```ts
pi.on("context", async (event) => ({
  messages: event.messages.filter((message) => !isBtwResultMessage(message)),
}))
```

Injection should still send a normal user/follow-up message containing the selected BTW answers.

### Clear/inject tombstones

JSONL is append-only. If slot 1 is cleared and later reused, labels like `BTW SESSION 1-1` are not enough to know which old records are stale.

Use a per-slot generation id and write a hidden tombstone on clear/inject:

```ts
pi.sendMessage({
  customType: "BTW SESSION",
  content: "cleared",
  display: false,
  details: {
    kind: "cleared",
    label: "BTW SESSION 1 CLEARED",
    slot: 1,
    generation,
    clearedAt: Date.now(),
  },
})
```

Restore algorithm:

1. Scan `BTW SESSION` custom messages in branch order.
2. Group by `slot + generation`.
3. Mark generations with `kind: "cleared"` as closed.
4. Restore only the latest non-cleared generation for each slot.
5. Keep original slot numbers. Do not renumber.

### Restored follow-ups

Child Pi RPC processes are ephemeral. After restart, mode switch, or process disposal, the UI can restore the session from JSONL, but the child process memory is gone.

For the next follow-up in a restored slot, seed the new child prompt with prior Q&A turns:

```text
This is a restored Q&A session. Continue from these prior turns...

Q1: ...
A1: ...

Q2: ...
A2: ...

Gather context required to answer this follow-up question and naturally resume the Q&A

Q3: ...
```

Only do this when:

- the slot was restored from JSONL
- there are previous completed turns
- there is no live child process for that slot

Live child sessions should keep using normal follow-up prompts.

### Shortcuts

The Howcode port settled on Ctrl+Alt chords:

- `ctrl+alt+z` compose `/btw `
- `ctrl+alt+c` inject & clear active slot
- `ctrl+alt+x` clear active slot
- `ctrl+alt+left/right` switch slots
- `ctrl+alt+up/down` unfold/fold
- `ctrl+alt+1..9` switch directly to slot

The important semantic rename: inject should be labeled **inject & clear**, because it consumes the slot.

## Reference implementation in Howcode

Howcode branch/files used as reference:

- Native entrypoint: `/home/igorw/Work/howcode/desktop/native-extensions/howcode-native-smart-btw.mjs`
- Child RPC process: `/home/igorw/Work/howcode/desktop/native-extensions/smart-btw/child.mjs`
- State/restore/slot logic: `/home/igorw/Work/howcode/desktop/native-extensions/smart-btw/session-state.mjs`
- Message/tombstone format: `/home/igorw/Work/howcode/desktop/native-extensions/smart-btw/messages.mjs`
- TUI widget rendering split: `/home/igorw/Work/howcode/desktop/native-extensions/smart-btw/widget.mjs`
- Constants/key hints: `/home/igorw/Work/howcode/desktop/native-extensions/smart-btw/constants.mjs`

Relevant commits:

- `4faeaeb0 Restore smart btw sessions from hidden messages`
- `d532e518 Project smart btw state from thread history`
- `b1abf72a Stabilize smart btw gui projection`
- `d53c4264 Seed restored smart btw follow-ups`

