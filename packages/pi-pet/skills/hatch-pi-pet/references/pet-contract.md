# Pi Pet v2 contract

## Package

```text
pets/<pet-id>/
├── PET.md
├── pet.json
├── spritesheet.webp
└── validation.json
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

Pi Pet deliberately consumes the Codex-compatible v2 base format. An optional `pet.pi.json` extension layer may add later Pi-only actions; it is not part of hatching the standard atlas.

## Atlas

- PNG or WebP, exactly `1536×2288`.
- 8 columns × 11 rows; each cell `192×208`.
- Rows 0–8 are standard animations. Rows 9–10 are sixteen clockwise look directions.
- Used cells contain visible pixels. Unused standard-row cells are fully transparent.
- Fully transparent pixels have zero RGB residue. No background, guide marks, seams, clipping, or colored alpha fringe.
- The intermediate 8×9 `1536×1872` atlas is review-only and never packaged.

Coordinates are deterministic: `x = column × 192`, `y = row × 208`.

## Data boundary

Packages are inert data. Asset paths stay relative, regular, bounded PNG/WebP files inside the package. Never add scripts, HTML, event handlers, remote URLs, absolute paths, traversal, or escaping symlinks.
