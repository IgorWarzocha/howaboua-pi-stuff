---
"@howaboua/pi-subagent-review": patch
---

Make review disposition reliable while surfacing package updates automatically.

- Preserve custom-rendered findings, then route verification and user disposition through a normal agent turn.
- Show unseen package release notes in one startup card.
- Allow `"suppress": true` in `howaboua-pi-stuff-changelog.json` to hide release notes while keeping seen versions current.
