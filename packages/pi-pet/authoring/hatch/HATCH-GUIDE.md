# Hatch a Pi Pet

Use this guide for a complete character, full Codex-v2 atlas repair, nine standard animations, or sixteen look directions. Deterministic tooling requires uv and Python 3.11+. Visual work requires an image-generation capability, supplied images, or an explicit external handoff. See `LICENSE.txt` for the authoring-tool license.

## Run boundary

1. Read the repository and nearest `AGENTS.md` files. Resolve `HATCH_DIR` to this guide's directory and `REPO_ROOT` to the Pi Pet package directory.
2. Collect a concept, optional name/description, style, brand cues, and reference images. Infer omitted creative details; ask only when identity direction is genuinely ambiguous.
3. Keep generated work outside `pets/`. Default to `$REPO_ROOT/.pi-pet-runs/<pet-id>`; reuse an existing run only when deliberately resuming it.
4. For an existing pet, preserve every passing row. Never overwrite its package until the replacement passes and the user requested replacement.
5. Keep this visible progression: **prepare → establish identity → generate poses → review and hatch**.

Read `references/pet-contract.md` and `references/animation-rows.md` before preparing a run.

## Visual capability

Choose by capability, not vendor or tool name:

1. Prefer an available image-generation capability that can accept prompts, reference images, and produce downloadable PNG/WebP files.
2. Use one isolated generation worker per visual job when workers are available. Up to three independent standard-row jobs may run concurrently after the canonical base exists.
3. Every row job must receive every `input_images` entry from `visual-jobs.json`. Only the base may be prompt-only.
4. Never ask a generator for the complete atlas. Generate the base, standard strips, cardinal strip, and two coherent look strips as separate jobs; deterministic scripts own extraction and assembly.
5. If no native image generation exists, follow `references/visual-generation.md`. Offer a prompt-and-upload handoff for ChatGPT, Gemini, Grok Imagine, or another service. If authorized browser control is available, offer to operate the user's logged-in service without requesting credentials or purchasing anything.
6. A missing generator is not permission to draw, tile, rotate, or procedurally synthesize the missing art. Prepare the run and exact handoff, then resume when images exist.

## Prepare

Use the locked authoring environment:

```bash
uv run --project "$HATCH_DIR" --locked python "$HATCH_DIR/scripts/prepare_pet_run.py" \
  --pet-name "<Name>" \
  --description "<one sentence>" \
  --reference /absolute/reference.png \
  --pet-notes "<stable identity description>" \
  --style-preset auto \
  --style-notes "<optional constraints>" \
  --output-dir "$REPO_ROOT/.pi-pet-runs/<pet-id>"
```

Omit flags that have no input. For a bare brand/product request, first research 2–4 preferably official sources and save a compact brief; do not copy logos, slogans, UI, or readable marks. Pass the brief and source URLs to `prepare_pet_run.py`.

The command creates:

- `pet_request.json`: identity, style, chroma key, geometry, and provenance inputs.
- `visual-jobs.json`: dependency graph, prompts, references, output paths, and job status.
- `prompts/`: service-neutral prompts.
- `references/layout-guides/`: slot-count and safe-area guides; generated art must not reproduce guide marks.

Inspect `visual-jobs.json`. A pending job is ready only when every `depends_on` job is complete. Send only jobs with a non-null `generation_capability` to an image generator; `visual-approval-gate` jobs are evidence-backed parent transitions.

## Establish identity and standard rows

1. Generate `base`; inspect one centered, full-body pet on its flat chroma background. Copy the selected file to `decoded/base.png` and `references/canonical-base.png`; record its path and completion in `visual-jobs.json` atomically.
2. Generate `idle` and `running-right` first. Confirm identity, calm idle motion, and readable gait before spending the remaining jobs.
3. Mirror `running-left` only when markings, lighting, props, and handedness remain correct:

```bash
uv run --project "$HATCH_DIR" --locked python "$HATCH_DIR/scripts/derive_running_left_from_running_right.py" \
  --run-dir "$RUN_DIR" --confirm-appropriate-mirror \
  --decision-note "<why identity and meaning survive mirroring>"
```

The derivation leaves `running-left` staged, not complete. Run the same extraction and visual QA as any generated row, then mark it complete. Otherwise generate it independently. Generate all other standard rows independently from the canonical base.

4. After copying each selected strip to its declared `decoded/` path, immediately run:

```bash
ROW_ID=<job-id>
uv run --project "$HATCH_DIR" --locked python "$HATCH_DIR/scripts/extract_strip_frames.py" \
  --decoded-dir "$RUN_DIR/decoded" --output-dir "$RUN_DIR/qa/rows/$ROW_ID/frames" \
  --states "$ROW_ID" --method auto
uv run --project "$HATCH_DIR" --locked python "$HATCH_DIR/scripts/inspect_frames.py" \
  --frames-root "$RUN_DIR/qa/rows/$ROW_ID/frames" \
  --json-out "$RUN_DIR/qa/rows/$ROW_ID/review.json" --states "$ROW_ID" --require-components
```

Do not mark the job complete until deterministic inspection and a quick visual check pass. Repair known clipping, extraction, identity, or semantics immediately. `stable-slots` is allowed only when the generated strip itself has stable scale and placement but component extraction introduces popping.

5. When all nine rows pass, extract all frames, inspect them, compose the intermediate 8×9 atlas, and create the contact sheet and previews using the commands in `references/standard-assembly.md`. Inspect every preview before look generation. The 8×9 atlas is never packageable.

## Look directions

Read `references/look-directions.md` before this stage.

1. Write `qa/look-mechanics.md`: what anchors, what leads the gaze, what follows, eye construction, body deformation, and prop constraints.
2. Generate one four-pose strip: `000 up`, `090 screen-right`, `180 down`, `270 screen-left`. Extract it with `extract_cardinal_anchors.py`, inspect at pet size, and compose `decoded/look-anchors-approved.png`. Regenerate an ambiguous cardinal before continuing. Complete the evidence gate only after those artifacts pass:

```bash
uv run --project "$HATCH_DIR" --locked python "$HATCH_DIR/scripts/approve_cardinals.py" \
  --run-dir "$RUN_DIR" --reviewed-by "<agent or user identity>" \
  --qa-note "<visible evidence that all four cardinals are correct>"
```
3. Generate row 9 as one coherent eight-pose family from approved cardinals. Register it immediately with `assemble_extended_atlas.py --look-row-9`; inspect its registered cells and edge report.
4. Generate row 10 only after row 9 passes. Attach the approved cardinals and completed row 9 so scale, registration, and the `157.5→180` / `337.5→000` boundaries remain coherent.
5. A failed direction regenerates its complete eight-pose row. Never patch one normalized final cell into a new pet.

## Assemble and review

Run the final commands in `references/final-assembly.md` in order:

1. Assemble both look rows into the 8×11 atlas.
2. Apply exactly one edge-local chroma despill pass.
3. Validate geometry, alpha, used cells, transparent unused cells, and chroma contamination.
4. Produce the extended contact sheet, focused direction sheet, blind A/B sheet, and continuity report.
5. Use three isolated vision-capable reviewers for the blind sheet, combine strict-majority verdicts, then run one independent final visual reviewer. Follow `references/reviewer-protocol.md`.
6. If isolated reviewers are unavailable, ask the user to inspect the blind and labeled sheets. Record reduced assurance and `reviewed_by: "user"`; never claim multi-agent consensus.

Deterministic success does not replace visual QA. Visual confidence does not waive deterministic failure.

## Package

Package only after `references/qa-rubric.md` passes:

```text
pets/<pet-id>/
├── PET.md
├── pet.json
├── spritesheet.webp
└── validation.json
```

- Copy only the final despilled `spritesheet-extended.webp` as `spritesheet.webp`.
- Write `pet.json` with `spriteVersionNumber: 2` and `spritesheetPath: "spritesheet.webp"`.
- Write `PET.md` with identity, personality, included actions, generation inputs, tool/service provenance, review method, and licensing uncertainty.
- Copy final deterministic validation as `validation.json`; retain full QA evidence in the run directory.
- Run `bun <pi-pet-package>/scripts/validate-pet.mjs <absolute-package-directory>`. Rebuild Pi Pet, refresh its GipPity display, then inspect at display scale and exercise every standard action.
- Run the repository's strict gate before installation or desktop launch.

## Repair and stop conditions

- Classify failures as semantics, identity, source geometry, connectivity, extraction, chroma, continuity, or final visual QA.
- Prefer deterministic correction for deterministic failure. Regenerate only when source art is wrong.
- Preserve passing properties and regenerate the smallest package-eligible unit: one standard row or one complete coherent look row.
- If the same root failure recurs twice, change strategy rather than paraphrasing the same prompt.
- Stop when all acceptance gates pass, the user cancels, or an external capability is unavailable after producing a resumable handoff. Never package a partial pet as complete.

## Tooling check

After changing bundled scripts:

```bash
uv run --project "$HATCH_DIR" --locked python -m unittest discover \
  -s "$HATCH_DIR/tests" -p 'test_*.py' -v
```
