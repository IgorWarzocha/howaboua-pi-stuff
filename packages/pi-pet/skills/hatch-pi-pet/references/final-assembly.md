# Final assembly

Set the run's chroma key:

```bash
CHROMA_KEY=$(jq -r '.chroma_key.hex' "$RUN_DIR/pet_request.json")
```

Register row 9 before generating row 10:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/assemble_extended_atlas.py" \
  --base-atlas "$RUN_DIR/final/spritesheet.webp" --look-row-9 "$RUN_DIR/decoded/look-row-9.png" \
  --neutral-cell "$RUN_DIR/frames/idle/00.png" --chroma-key "$CHROMA_KEY" \
  --registered-row-output "$RUN_DIR/qa/look-row-9-registered.png" \
  --registration-manifest-output "$RUN_DIR/qa/look-row-9-registration.json"
```

Assemble row 10 against the approved row-9 transform:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/assemble_extended_atlas.py" \
  --base-atlas "$RUN_DIR/final/spritesheet.webp" \
  --registered-row-9 "$RUN_DIR/qa/look-row-9-registered.png" \
  --row-9-registration "$RUN_DIR/qa/look-row-9-registration.json" \
  --look-row-10 "$RUN_DIR/decoded/look-row-10.png" \
  --neutral-cell "$RUN_DIR/frames/idle/00.png" --chroma-key "$CHROMA_KEY" \
  --output "$RUN_DIR/final/spritesheet-extended.png" \
  --webp-output "$RUN_DIR/final/spritesheet-extended.webp" \
  --manifest-output "$RUN_DIR/final/spritesheet-extended.json"
```

Run one—and only one—despill pass, then validate:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/despill_chroma_edges.py" \
  "$RUN_DIR/final/spritesheet-extended.png" --output "$RUN_DIR/final/spritesheet-extended.png" \
  --webp-output "$RUN_DIR/final/spritesheet-extended.webp" --chroma-key "$CHROMA_KEY" \
  --json-out "$RUN_DIR/qa/chroma-despill-extended.json"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/validate_atlas.py" \
  "$RUN_DIR/final/spritesheet-extended.webp" \
  --json-out "$RUN_DIR/final/validation-extended.json" --chroma-key "$CHROMA_KEY" --require-v2
```

Produce QA media:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/make_contact_sheet.py" \
  "$RUN_DIR/final/spritesheet-extended.webp" --output "$RUN_DIR/qa/contact-sheet-extended.png"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/make_direction_qa_sheet.py" \
  "$RUN_DIR/final/spritesheet-extended.webp" --output "$RUN_DIR/qa/look-directions.png"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/make_direction_blind_qa_sheet.py" \
  "$RUN_DIR/final/spritesheet-extended.webp" --output "$RUN_DIR/qa/direction-blind-pairs.png" \
  --answer-key "$RUN_DIR/qa/direction-blind-answer-key.json"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/measure_direction_continuity.py" \
  "$RUN_DIR/final/spritesheet-extended.webp" --json-out "$RUN_DIR/qa/look-continuity.json"
```

After three isolated verdict files exist:

```bash
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/combine_direction_blind_verdicts.py" \
  --verdicts "$RUN_DIR/qa/direction-blind-verdicts-1.json" \
  --verdicts "$RUN_DIR/qa/direction-blind-verdicts-2.json" \
  --verdicts "$RUN_DIR/qa/direction-blind-verdicts-3.json" \
  --json-out "$RUN_DIR/qa/direction-blind-verdicts.json"
uv run --project "$SKILL_DIR" --locked python "$SKILL_DIR/scripts/validate_direction_blind_verdicts.py" \
  --answer-key "$RUN_DIR/qa/direction-blind-answer-key.json" \
  --verdicts "$RUN_DIR/qa/direction-blind-verdicts.json" \
  --json-out "$RUN_DIR/qa/direction-blind-validation.json"
```
