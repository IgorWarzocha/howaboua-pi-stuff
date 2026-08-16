---
name: pi-pet
description: "Control, extend, validate, or reload existing animated Pi Pet companions. Use for pet actions/messages, action catalogs, PET.md, pet.json, pet.pi.json, or adding one animation. Not complete new-pet generation; use hatch-pi-pet for that."
compatibility: "Requires the pi-pet broker for live control; authoring requires PNG/WebP assets and may use an available image-generation tool."
---

# Pi Pet

## Live control

1. Use `pet_show` only when the action carries useful task state or personality; lifecycle states already update automatically.
2. Use `pet_say` for proactive short context, not logs, secrets, commands, or long answers. Never call it to answer a `[Pi Pet prompt from ...]`; the final assistant reply is delivered to the pet automatically.
3. Read the active pet's `PET.md` and manifests before choosing an unfamiliar action.
4. Unknown actions are a data-authoring task. Do not guess aliases repeatedly.

The bundled Codex-v2 actions are `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`. Semantic aliases include `active→running`, `working→running`, `thinking→running`, `settled→review`, `success→jumping`, `error→failed`, and `hello→waving`; aliases are alternate names, not additional animations. Sixteen pointer-direction poses are controlled by the display and are not agent actions. The catalog may contain more.

## Extend a pet

Read `references/pet-format.md`, then:

1. Locate the active package under `<pi-pet-package>/pets/<id>/`. Read its `PET.md`, `pet.json`, optional `pet.pi.json`, and nearest `AGENTS.md`. For a complete new character with all standard rows and visual review, stop and load `hatch-pi-pet`.
2. Preserve character identity and every action that already passes. For a new action, prefer a separate bounded PNG/WebP atlas plus a `pet.pi.json` entry.
3. Use an image-generation capability only when available and authorized. Keep generated art grounded in the approved base; never generate executable UI or scripts into a pet package.
4. Define frame coordinates and durations explicitly. Names use lowercase letters, numbers, dots, underscores, or hyphens and remain open strings.
5. Run `pi-pet validate <absolute-pet-directory>`. Stop on any manifest, traversal, asset, geometry, or frame-bound error.
6. Inspect the animation at actual pet scale. Geometry passing is not visual QA: reject clipping, identity drift, static loops, frame popping, opaque backgrounds, and colored alpha fringe.
7. Update `PET.md` with personality/action semantics and provenance. Do not copy validation history into agent instructions.
8. Call `pet_reload`, then exercise the exact new action with `pet_show`.

## Boundaries

- Pet packages are inert data. Never add JavaScript, shell commands, remote URLs, HTML, or event handlers to a manifest.
- Asset paths stay relative to the pet directory and cannot use `..`, absolute paths, backslashes, or escaping symlinks.
- Do not mutate the original Codex rows merely to add a Pi-only action; use `pet.pi.json` and a separate asset unless a full repair is intended.
- Do not package a failing or visually unreviewed pet. Preserve source and licensing uncertainty explicitly.

## Recovery

- **Broker unavailable:** report the concrete connection error; do not install or expose another service as a fallback.
- **Unknown action:** inspect the active pet manifests; add data only when no existing action fits.
- **Reload fails:** retain the last working runtime state, fix the reported package error, validate, and retry once.
- **Image capability unavailable:** accept supplied artwork or stop at a validated manifest/placeholder plan; do not claim the pet was visually completed.
