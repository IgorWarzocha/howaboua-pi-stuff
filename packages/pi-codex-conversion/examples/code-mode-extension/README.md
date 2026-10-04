# Code Mode extension example

This copyable Pi package registers one `echo` tool normally and supplies an explicit Code and Notebook integration. Explicit integration takes precedence over automatic Pi-tool bridging.

Use this pattern for custom usage, blocking behavior or result conversion. Ordinary Pi-callable tools need only normal registration. For explicit integration, replace the tool in `index.ts`, keep both registrations, and declare Pi Codex 3.0.24 or newer as a peer dependency. The direct import makes Pi Codex required. Use a guarded dynamic import instead when the extension should continue working in normal Pi without it.
