# @howaboua/pi-skills

The shareable skill bundle from this repository. Pi discovers the skills after installation and loads them when a task matches; `/skill:<name>` invokes one explicitly.

## Install

```bash
pi install npm:@howaboua/pi-skills
```

## Included skills

- Foundations: `agents-md`, `communication`, `skill-creator`
- Code: `codebase-hygiene`, `code-review`, `project-reference-research`, `repository-delivery`, `scratchpad`
- Harness and agent engineering: `agent-session-diagnostics`, `agent-tool-design`, `extension-design`, `harness-checklist`, `instruction-calibration`, `prompt-caching`
- Browser control: `chrome-cdp`

`omarchy-help` is not included because it targets Arch desktops configured with Omarchy. Install `@howaboua/pi-skill-omarchy-help` separately when that matches your workstation.
