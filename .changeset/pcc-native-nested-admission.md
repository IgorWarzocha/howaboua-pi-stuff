---
"@howaboua/pi-codex-conversion": patch
---

Removed Structured execution mode. VM Code is now the default, and saved Structured settings (`normal`) migrate to VM Code.

Set the current model to Off under `/codex` → General to use Pi's own tools and provider behaviour. Selected models scope uses a provider-and-model whitelist. Previously enabled Responses providers seed a model as On when you first activate it in Automatic or All providers. Existing model choices are preserved. Default follows the scope without importing the old provider choice again.

Fixed PCC's native Code and Notebook tools to use Pi's tool admission hooks. The nested catalogue follows Pi's callable selection, and stale names no longer bypass it. PCC preflight and completion hooks still run for these tools. An in-flight Pi call can delay an outer yield until the call settles.

PCC preserves Pi's selected native Codemode when switching models or resuming a session. Hiding a declaration no longer blocks calls. Pi tool allowlists and guards still apply.

Older Code sessions whose saved selection could not record PCC's nested tools regain the default nested tools. Deliberate selections, including an empty nested selection, are preserved.

Update Codex Guardian alongside PCC to avoid duplicate reviews of these nested calls.
