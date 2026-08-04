# Realtime system prompt changelog

This is migration guidance for the agent editing the user's global prompt at `~/.pi/agent/REALTIME-SYSTEM-PROMPT.md`. The extension never rewrites an existing prompt because it may contain extensive personal customization.

The packaged `REALTIME-SYSTEM-PROMPT.md` beside this file is the latest reference template. Do not replace the user's prompt wholesale unless they explicitly ask. Preserve their identity, tone, speaking style, preferences, and intentional routing choices.

## Migration procedure

1. Read the user's complete prompt before editing it.
2. Read its `codex-voice-prompt-version` marker. A prompt without a marker is schema 1.
3. Apply each schema change after that version in ascending order, adapting the wording to the user's existing structure and style.
4. Preserve personal configuration and resolve conflicts in favor of the user's explicit intent. Ask only when a conflict is materially ambiguous.
5. Replace any old marker with exactly one current marker on its own line near the top of the file.
6. Re-read the result and confirm that the new behavior is represented without duplicated or contradictory instructions.

## Schema 1

Initial realtime prompt. It established:

- the spoken identity and tone
- one-assistant presentation across realtime voice and Pi
- delegation of actions, tools, project context, and nontrivial reasoning to Pi
- concise spoken summaries of authoritative Pi results
- spoken delivery and conversation preferences

Schema 1 prompts have no version marker.

## Schema 2

Marker: `<!-- codex-voice-prompt-version: 2 -->`

Added session continuity. When asked about current-session progress, voice should answer from known context. When context is insufficient, it should delegate to Pi and briefly speak the result rather than claiming that it cannot access the session.

Add or adapt a `Session continuity` instruction carrying that behavior.

The extension also began appending a connected Pi runtime contract at request time. That contract is not part of the editable user prompt and needs no migration.

## Schema 3

Marker: `<!-- codex-voice-prompt-version: 3 -->`

Added conversational initiative and an interruption guard:

- Treat voice as a live conversation rather than push-to-talk.
- After the user yields the floor with a hum, mumble, sigh, laugh, false start, or trailing hesitation, respond with a brief varied and context-aware contribution instead of waiting for a formal request.
- Distinguish a yielded floor from speech still in progress and do not talk over an active utterance.
- Keep filler, fragments, and ambiguous low-content turns in the voice conversation. Delegate only once a complete actionable request emerges.

Add or adapt a `Conversational initiative` instruction carrying those behaviors, then update the marker to schema 3.
