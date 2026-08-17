# Import an existing pet

Use this route when the user already has a pet package from Codex, ChatGPT, or another Hatch Pet run. Import the package as data; do not rehatch compatible artwork.

## Find and classify the source

1. Prefer a path supplied by the user. Codex custom pets normally live at `${CODEX_HOME:-$HOME/.codex}/pets/<pet-id>/`. A source on another user-authorized host may be copied through that host's ordinary file transport.
2. Inspect the source before copying it. A directly compatible package contains `pet.json` and the relative PNG/WebP named by `spritesheetPath`.
3. Direct import requires `spriteVersionNumber: 2` and a `1536×2288` atlas. An 8×9 or `1536×1872` v1 atlas needs completion through `../hatch/HATCH-GUIDE.md`; an ordinary generated character image is a hatch reference, not a pet package.

## Recover Codex built-in assets

Codex also caches its built-in pets without custom manifests:

- TUI assets normally appear under `${CODEX_HOME:-$HOME/.codex}/cache/tui-pets/v1/assets/` as `<pet>-spritesheet-*.webp`. These are legacy `1536×1872` atlases and need the two look-direction rows completed through the hatch guide before Pi Pet can load them.
- Desktop assets live inside the installed or cached Codex application's `content/webview/assets/` directory as `<pet>-spritesheet-<version>-<hash>.webp`. Linux native builds commonly expose them under `~/.cache/codex-desktop-linux-native-build/codex-app/content/webview/assets/` or a `~/.cache/codex-update-manager/workspaces/<version>/codex-app/content/webview/assets/` workspace. Other roots vary by platform and install method; search the user's Codex application and cache directories for `*-spritesheet-*.webp`. Current desktop atlases may already be v2 `1536×2288` assets.

For a v2 desktop asset, copy the selected atlas into staging as `spritesheet.webp` and create the minimal `pet.json` from `pet-format.md`, using the filename's pet name as a starting point for the id and display name. Validate dimensions and inspect the rebuilt animations rather than trusting the filename version. Record the Codex application asset and original filename in `PET.md`; redistribution terms remain uncertain, but that uncertainty does not block importing it into the user's local pet library.

## Stage the package

Resolve the package root from this guide's installed path and the durable destination as `<pi-agent-directory>/pi-pet/pets/<pet-id>`. The destination directory name and `pet.json` id must match.

1. Create a fresh staging root under `<pi-agent-directory>/pi-pet/runs/<pet-id>/` with the package in a child directory named exactly `<pet-id>`; validation requires that basename to match the manifest id.
2. Copy `pet.json`, its referenced spritesheet, and any supplied `PET.md` or `validation.json` with ordinary filesystem commands. If a supplied `pet.pi.json` references extra local PNG/WebP assets, copy those too; leave unrelated files behind.
3. If `PET.md` is absent, create a short one recording the display name, description, `source_format: codex-v2`, known provenance, included standard actions, and any redistribution uncertainty. Do not invent ownership or licensing.
4. From the installed Pi Pet package root, validate the staged directory:

```bash
npm run pet:validate -- <absolute-staged-pet-directory>
```

Fix or reroute any contract failure; never edit dimensions or version metadata merely to silence validation.

## Place and load it

- If the durable destination is absent, move the validated `<pet-id>` staging directory into place and remove its empty staging root.
- If an existing durable or bundled pet has the same id and the manifest plus assets are byte-identical, keep the existing copy and do not duplicate it.
- If the same id contains different data, show the conflict and ask before replacement unless the user already requested replacement. Validate the replacement before removing the old directory; leave no backup after an explicit replacement.

Then rebuild from the installed package root:

```bash
npm run pet:rebuild -- <pet-id>
```

The rebuild validates again, generates the durable miniapp, and selects the imported pet globally. A repository-level selection still wins. Tell the user to run `/reload`; slash commands are user actions. After reload, inspect the pet at actual scale and exercise one known action with `pet_show`.
