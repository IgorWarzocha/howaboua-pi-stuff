# Code Mode extension example

This copyable Pi package registers one `echo` tool normally and exposes the same definition inside Code and Notebook Mode.

Replace the tool in `index.ts`, keep both registrations, and declare Pi Codex 3.0.24 or newer as a peer dependency. The direct import makes Pi Codex required. Use a guarded dynamic import instead when the extension should continue working in normal Pi without it.
