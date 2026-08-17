# Pi Pet guide

This guide is the on-demand entry point for `/pet <request>`. Resolve every relative path from this file. Its installed package owns bundled templates and tools; durable user pets and authoring runs live under `<pi-agent-directory>/pi-pet/`, normally `~/.pi/agent/pi-pet/`.

## Route the request

- To import an existing Codex or ChatGPT pet package, read `references/import-existing-pet.md` and follow it instead.
- For live reactions, action catalogs, one additional animation, or repair of one existing action, continue below.
- For a complete new character, full atlas repair, nine standard animations, or sixteen look directions, read `hatch/HATCH-GUIDE.md` and follow it instead.
- To select a pet for the current repository, ensure that durable pet has been rebuilt, write the repository config described below, then tell the user to run `/reload`.
- Separate pet data from renderer behavior. An animation such as `catching-mouse` can be authored as inert data; automatically triggering it near a pointer requires a separate renderer change.

## Repository selection

The project Pi config directory is normally `.pi/`. Write `pi-pet.json` there with only:

```json
{ "schemaVersion": 1, "pet": "<pet-id>" }
```

This selects an existing durable pet without copying assets into the repository. Repository selection overrides the global default; a missing repository selection uses the global default, then bundled Clawa. Do not claim success until `<pi-agent-directory>/pi-pet/web/<pet-id>/catalog.json` exists; if needed, rebuild that pet first.

## Live control

1. Use `pet_show` only when the reaction carries useful task state or personality; lifecycle states already update automatically.
2. Read the active pet's `PET.md` and manifests before choosing an unfamiliar action.
3. Unknown actions are a data-authoring task. Do not guess aliases repeatedly.

The bundled actions are `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`. Semantic aliases include `active→running`, `working→running`, `thinking→running`, `settled→review`, `success→jumping`, `error→failed`, and `hello→waving`. Sixteen pointer-direction poses are display-owned and are not agent actions.

## Extend a pet

Read `references/pet-format.md`, then:

1. Resolve the installed package from this guide's absolute path and use it as command working directory. If the repository config selects a pet, run `npm run pet:prepare -- <that-id>`; otherwise run `npm run pet:prepare` or pass an explicit ID. It copies a bundled template only when no durable user pet exists and prints the user pet and run paths. Read that pet's `PET.md`, `pet.json`, and optional `pet.pi.json`. For a complete new character, switch to `hatch/HATCH-GUIDE.md`.
2. Preserve character identity and every passing action. Prefer a separate bounded PNG/WebP atlas plus a `pet.pi.json` entry for one new action.
3. Define frame coordinates and durations explicitly. Names use lowercase letters, numbers, dots, underscores, or hyphens; `list` is reserved for action discovery.
4. Follow **Rebuild and load** below. The build validates manifests, traversal, assets, decoded dimensions, and frame geometry before producing the GipPity miniapp.
5. Inspect the animation at actual pet scale. Reject clipping, identity drift, static loops, frame popping, opaque backgrounds, and colored alpha fringe.
6. Update `PET.md` with personality, action semantics, and provenance, then exercise the action with `pet_show` after the user reloads Pi.

## Rebuild and load

The `/pet` prompt gives this guide's absolute installed path. Resolve the package root exactly two directories up from that path (`<package>/authoring/PET-GUIDE.md` → `<package>`), use it as the command working directory, and do not assume the current directory is a checkout or monorepo. After changing the durable user pet printed by `pet:prepare`, run there:

```bash
npm run pet:validate -- <absolute-user-pet-directory>
npm run pet:rebuild -- <pet-id>
```

The rebuild writes the generated miniapp under the durable Pi Pet directory and makes that pet the global default; it never modifies the npm package. A repository selection still takes precedence. The running extension keeps its catalog in memory, so after a successful rebuild tell the user to run `/reload`; slash commands are user actions. Reloading Pi resolves the repository, global, then bundled selection and restarts configured Electron displays. A separately opened browser display may also need a page refresh. Only then exercise new or repaired actions with `pet_show`.

## Boundaries

- Pet packages are inert data. Never add JavaScript, shell commands, remote URLs, HTML, or event handlers to a manifest.
- Asset paths stay relative to the pet directory and cannot use `..`, absolute paths, backslashes, or escaping symlinks.
- Do not mutate the original Codex rows merely to add a Pi-only action; use `pet.pi.json` and a separate asset unless a full repair is intended.
- Do not package a failing or visually unreviewed pet. Preserve source and licensing uncertainty explicitly.

## Recovery

- **GipPity unavailable:** report the concrete error; do not start another server or transport as fallback.
- **Unknown action:** inspect the active pet manifests and use or add valid data.
- **Build fails:** fix the reported package error and rerun the build once; do not bypass validation or ask the user to reload a failed build.
- **Image capability unavailable:** accept supplied artwork or stop at a validated plan; do not claim visual completion.
