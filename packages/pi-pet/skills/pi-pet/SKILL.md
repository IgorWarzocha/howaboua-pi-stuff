---
name: pi-pet
description: "Control or extend existing animated Pi Pet companions. Use for pet reactions, action catalogs, PET.md, pet.json, pet.pi.json, or adding one animation. Not complete new-pet generation; use hatch-pi-pet for that."
compatibility: "Requires GipPity Control for live display; authoring requires PNG/WebP assets and may use an available image-generation tool."
---

# Pi Pet

## Live control

1. Use `pet_show` only when the reaction carries useful task state or personality; lifecycle states already update automatically.
2. Read the active pet's `PET.md` and manifests before choosing an unfamiliar action.
3. Unknown actions are a data-authoring task. Do not guess aliases repeatedly.

The bundled actions are `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`. Semantic aliases include `active→running`, `working→running`, `thinking→running`, `settled→review`, `success→jumping`, `error→failed`, and `hello→waving`. Sixteen pointer-direction poses are display-owned and are not agent actions.

## Extend a pet

Read `references/pet-format.md`, then:

1. Locate the package under `<pi-pet-package>/pets/<id>/`. Read its `PET.md`, `pet.json`, optional `pet.pi.json`, and nearest `AGENTS.md`. For a complete new character, stop and load `hatch-pi-pet`.
2. Preserve character identity and every passing action. Prefer a separate bounded PNG/WebP atlas plus a `pet.pi.json` entry for one new action.
3. Define frame coordinates and durations explicitly. Names use lowercase letters, numbers, dots, underscores, or hyphens.
4. Run the Pi Pet build; it validates manifests, traversal, assets, decoded dimensions, and frame geometry before producing the GipPity miniapp.
5. Inspect the animation at actual pet scale. Reject clipping, identity drift, static loops, frame popping, opaque backgrounds, and colored alpha fringe.
6. Update `PET.md` with personality, action semantics, and provenance, then refresh the GipPity display and exercise the action with `pet_show`.

## Boundaries

- Pet packages are inert data. Never add JavaScript, shell commands, remote URLs, HTML, or event handlers to a manifest.
- Asset paths stay relative to the pet directory and cannot use `..`, absolute paths, backslashes, or escaping symlinks.
- Do not mutate the original Codex rows merely to add a Pi-only action; use `pet.pi.json` and a separate asset unless a full repair is intended.
- Do not package a failing or visually unreviewed pet. Preserve source and licensing uncertainty explicitly.

## Recovery

- **GipPity unavailable:** report the concrete error; do not start another server or transport as fallback.
- **Unknown action:** inspect the active pet manifests and use or add valid data.
- **Build fails:** fix the reported package error and rerun once; do not bypass validation.
- **Image capability unavailable:** accept supplied artwork or stop at a validated plan; do not claim visual completion.
