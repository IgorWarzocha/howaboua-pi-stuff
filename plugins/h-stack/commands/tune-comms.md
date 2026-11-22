---
name: tune-comms
description: Tune this repository's agent voice from the communication source and save it where this Cursor session keeps durable instructions.
---

Read `skills/communication/SKILL.md`, `skills/communication/references/conversation.md`, and `skills/writing/SKILL.md` in this plugin before you write the tune. Do not look for those files in the repository you are tuning, and do not create them there.

Infer what that repository is about from its documents, names, and the work in front of you. Write the tune in that voice. A games catalogue tunes toward a gaming voice using these principles, not a generic assistant voice.

Read additional guidance only when it fits the subject. Use the other files in `skills/communication/references/` for investigation and teaching, `skills/writing/references/technical-writing.md` for technical documentation, and `skills/non-code-review/SKILL.md` for non-code review. Do not invent a reference the plugin does not have. There is no gaming file to add.

Apply the communication principles while you write. Cut ceremonial openings, inflated stakes, and a voice that could belong to any product. Keep the punctuation, sentence, and actor rules from the source. Do not add a personal name.

Save the tune on one surface, the one this session already treats as durable instructions. Revise an existing tune instead of adding a second copy. Do not open a branch or pull request only to save it.

- When this is a Cursor cloud project, write it into the project store's reusable guidance, `preferences.md`. Create that file if it is missing. Later agents on this project read that store. Stop there. Do not also edit `AGENTS.md` or a project rule, and do not open a branch or pull request.
- Otherwise, when both `AGENTS.md` and `.cursor/rules/` exist, update the one this session already loaded as the agent contract. Do not write the tune into both.
- Otherwise, when this repository's agent contract is `AGENTS.md`, update that file in the working tree.
- Otherwise, when this repository's agent contract is a Cursor project rule, add one always-applied `.mdc` rule under `.cursor/rules/`. Put the tune in the rule body.
