# @howaboua/pi-rescue

Adds `/rescue`, an alternate compaction pass for sessions you want to leave resumable without sending the whole old context to the main model.

Rescue uses a separately configured model and sends only user, assistant, and extension messages. Tool calls and tool results are omitted. The resulting summary is installed as a normal Pi compaction entry, so the session can continue normally.

## Install

```bash
pi install npm:@howaboua/pi-rescue
```

Run `/reload` after installing into an existing Pi process.

## Configuration

Add this to global `~/.pi/agent/settings.json`:

```json
{
  "rescue": {
    "provider": "your-provider",
    "model": "your-cheap-model",
    "reasoning": "low"
  }
}
```

Replace `your-provider` and `your-cheap-model` with a model already available to your Pi setup. If either is omitted, rescue uses the current session model. `reasoning` accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

`/rescue focus on the unresolved migration` adds extra guidance for that pass. Rescue refuses to fall back silently to ordinary compaction if its configured model or request fails.

## Why rescue?

Normal `/compact` is tied to the active session model. Rescue instead uses a separately configured model and deliberately trades tool transcript detail for a small, voice-aware checkpoint.

## Local development

```bash
bun install
bun run check
bun run pack:dry
pi -e ./index.ts
```
