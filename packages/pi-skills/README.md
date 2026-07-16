# @howaboua/pi-skills

The shareable skill bundle from this repository. Pi discovers the skills after installation and loads them when a task matches; `/skill:<name>` invokes one explicitly.

## Install

```bash
pi install npm:@howaboua/pi-skills
```

## Included skills

- `adversarial-qa` — executable attempts to falsify code behaviour
- `agent-native-hardening` — architecture reviews and structural refactors
- `agents-md` — scoped `AGENTS.md` authoring and maintenance
- `anti-ai-copy` — specific, natural prose that preserves voice
- `chrome-cdp` — local browser inspection and control through CDP
- `gh-issue-pr-flow` — GitHub issue, branch, PR, release, and review work
- `model-facing-api-design` — Pi tool contracts that models can use reliably
- `project-reference-research` — evidence-backed research in other repositories
- `skill-creator` — reusable skill design, validation, and packaging

`omarchy-help` is not included because it targets Arch desktops configured with Omarchy. Install `@howaboua/pi-skill-omarchy-help` separately when that matches your workstation.
