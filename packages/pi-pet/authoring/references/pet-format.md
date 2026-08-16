# Pi Pet package format

## Base package

Every package currently starts from a Codex-compatible v2 atlas:

```text
pets/<id>/
├── PET.md
├── pet.json
├── spritesheet.webp
├── pet.pi.json          # optional extension layer
└── validation.json      # optional retained authoring evidence
```

`pet.json`:

```json
{
  "id": "pet-id",
  "displayName": "Pet Name",
  "description": "One short sentence.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

The base atlas is PNG or WebP, exactly `1536x2288`: 8 columns by 11 rows, with `192x208` cells. Rows 0–8 are the standard actions; rows 9–10 are sixteen clockwise pointer-look frames. Transparent unused cells and clean transparent RGB remain part of the visual contract.

## Pi extension layer

`pet.pi.json` adds or replaces data-driven actions without changing the Codex manifest:

```json
{
  "schemaVersion": 1,
  "defaultAction": "idle",
  "aliases": {
    "party": "celebrate"
  },
  "actions": {
    "celebrate": {
      "asset": "celebrate.webp",
      "frames": [
        { "x": 0, "y": 0, "width": 192, "height": 208, "durationMs": 120 },
        { "x": 192, "y": 0, "width": 192, "height": 208, "durationMs": 260 }
      ],
      "loop": false,
      "next": "idle"
    }
  }
}
```

Rules:

- `schemaVersion` is exactly `1`.
- Unknown fields fail validation.
- Action names are 1–64 lowercase characters: letters, numbers, `.`, `_`, `-`.
- `asset` is a relative PNG/WebP path inside the package.
- Each action has 1–64 frames.
- Coordinates are non-negative integers and every frame stays within the decoded image.
- Width and height are 1–4096; a decoded asset may contain at most 16 million pixels.
- `durationMs` is an integer from 16–60,000.
- `loop` is a boolean.
- Optional `next` names an action that exists after the overlay is merged.
- Optional aliases map alternate names directly to real actions. Aliases are accepted by `pet_show` but are not separate animations or shown as picker actions.
- Assets are regular files up to 16 MiB. Escaping symlinks are rejected.

## Standard rows

| Row | Action | Frames | Durations (ms) |
|---:|---|---:|---|
| 0 | idle | 6 | 280, 110, 110, 140, 140, 320 |
| 1 | running-right | 8 | 120 × 7, 220 |
| 2 | running-left | 8 | 120 × 7, 220 |
| 3 | waving | 4 | 140 × 3, 280 |
| 4 | jumping | 5 | 140 × 4, 280 |
| 5 | failed | 8 | 140 × 7, 240 |
| 6 | waiting | 6 | 150 × 5, 260 |
| 7 | running | 6 | 120 × 5, 220 |
| 8 | review | 6 | 150 × 5, 280 |

`running` means active processing, not locomotion. `waiting` means Pi needs user input. `review` means output is ready to inspect.

## PET.md

Use frontmatter for stable identity metadata and prose for personality, action semantics, and provenance. `PET.md` guides humans and agents; it is not parsed by the renderer and cannot override `pet.json` or `pet.pi.json`.
